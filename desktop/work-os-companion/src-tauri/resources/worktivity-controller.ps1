param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("clock_in", "clock_out", "pause", "resume", "finish")]
    [string]$Action
)

$ErrorActionPreference = "Stop"
$TargetPattern = '^app://'
$DefaultPort = 9222
$script:RestoreRequired = $false

function Write-Result([string]$Status, [string]$Message = "", [bool]$RestoreRequired = $script:RestoreRequired) {
    @{ status = $Status; message = $Message; restore_required = $RestoreRequired } | ConvertTo-Json -Compress
    exit 0
}

function Find-WorktivityExecutable {
    $local = [Environment]::GetFolderPath("LocalApplicationData")
    $programFiles = [Environment]::GetFolderPath("ProgramFiles")
    $programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")
    $candidates = @(
        (Join-Path $local "Programs\worktivity\Worktivity.exe"),
        (Join-Path $local "Programs\Worktivity\Worktivity.exe"),
        (Join-Path $programFiles "Worktivity\Worktivity.exe"),
        (Join-Path $programFilesX86 "Worktivity\Worktivity.exe")
    )

    $uninstallPaths = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    foreach ($path in $uninstallPaths) {
        foreach ($entry in @(Get-ItemProperty -Path $path -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match "Worktivity" })) {
            if ($entry.InstallLocation) { $candidates += (Join-Path $entry.InstallLocation "Worktivity.exe") }
            if ($entry.DisplayIcon -match '^"?(.+?Worktivity\.exe)"?(?:,.*)?$') { $candidates += $Matches[1] }
        }
    }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

function Get-WorktivityProcesses([string]$Executable) {
    $expected = [IO.Path]::GetFullPath($Executable)
    return @(Get-CimInstance Win32_Process -Filter "Name = 'Worktivity.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $expected })
}

function Get-Target([int]$Port) {
    try {
        $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2
        $pages = @($targets | Where-Object { $_.type -eq "page" -and $_.url -match $TargetPattern })
        if ($pages.Count -eq 0) { return @() }
        # Prefer the visible desktop page over any transient app:// surface.
        $main = @($pages | Where-Object { $_.title -eq "Worktivity Desktop" } | Select-Object -First 1)
        if ($main.Count -gt 0) { return $main }
        return @($pages | Select-Object -First 1)
    } catch {
        return @()
    }
}

function Get-ExistingTarget([object[]]$Processes) {
    $ports = @()
    foreach ($process in $Processes) {
        if ($process.CommandLine -match '--remote-debugging-port(?:=|\s+)(\d{2,5})') {
            $ports += [int]$Matches[1]
        }
    }
    foreach ($port in @($ports | Select-Object -Unique)) {
        # Worktivity can expose the target before the renderer has painted the
        # clock controls. Wait briefly instead of killing a healthy launch.
        $deadline = (Get-Date).AddSeconds(5)
        do {
            $target = @(Get-Target $port)
            if ($target.Count -gt 0) { return @{ port = $port; target = $target[0] } }
            Start-Sleep -Milliseconds 500
        } while ((Get-Date) -lt $deadline)
    }
    return $null
}

function Test-PortInUse([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $client.Connect("127.0.0.1", $Port)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Get-AvailablePort {
    for ($port = $DefaultPort; $port -le ($DefaultPort + 20); $port++) {
        if (-not (Test-PortInUse $port)) { return $port }
    }
    return 0
}

function Stop-WorktivityForRestart([object[]]$Processes) {
    if ($Processes.Count -eq 0) { return }
    $ids = @($Processes | ForEach-Object { [int]$_.ProcessId })
    $roots = @($Processes | Where-Object { $ids -notcontains [int]$_.ParentProcessId })
    if ($roots.Count -eq 0) { $roots = @($Processes | Select-Object -First 1) }

    foreach ($root in $roots) {
        try {
            $windowProcess = Get-Process -Id ([int]$root.ProcessId) -ErrorAction Stop
            if ($windowProcess.MainWindowHandle -ne 0) { $null = $windowProcess.CloseMainWindow() }
        } catch {}
    }
    $deadline = (Get-Date).AddSeconds(5)
    do {
        Start-Sleep -Milliseconds 250
        $remaining = @(Get-WorktivityProcesses $script:Executable)
    } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)

    if ($remaining.Count -gt 0) {
        foreach ($root in $roots) {
            try { & taskkill.exe /PID ([int]$root.ProcessId) /T /F 2>$null | Out-Null } catch {}
        }
        $deadline = (Get-Date).AddSeconds(5)
        do {
            Start-Sleep -Milliseconds 250
            $remaining = @(Get-WorktivityProcesses $script:Executable)
        } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)
        foreach ($process in $remaining) {
            try {
                $current = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$process.ProcessId)" -ErrorAction Stop
                if ($current.ExecutablePath -and [IO.Path]::GetFullPath($current.ExecutablePath) -ieq [IO.Path]::GetFullPath($script:Executable)) {
                    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
                }
            } catch {}
        }
    }
    if (@(Get-WorktivityProcesses $script:Executable).Count -gt 0) { throw "Worktivity did not close for its controlled restart." }
}

function Invoke-CdpAction([object]$Target, [string]$RequestedAction, [int]$TimeoutSeconds = 15) {
    $actionJson = ConvertTo-Json -InputObject $RequestedAction -Compress
    $expression = @"
(async () => {
  const action = $actionJson;
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const label = (button) => clean(button.innerText || button.getAttribute("aria-label") || button.textContent);
  const mainButtons = () => [...document.querySelectorAll("button")];
  const findIn = (buttons, labels) => {
    for (const candidate of labels) {
      const button = buttons.find((item) => label(item) === candidate);
      if (button) return button;
    }
    return null;
  };
  const find = (labels) => findIn(mainButtons(), labels);
  const modalConfirm = () => {
    const buttons = mainButtons();
    const keepWorking = buttons.find((item) => label(item) === "keep working");
    const open = keepWorking
      || /clock out early/i.test(document.body && document.body.innerText || "");
    if (!open) return undefined;
    if (keepWorking) {
      let root = keepWorking.parentElement;
      while (root && root !== document.body) {
        const confirm = [...root.querySelectorAll("button")]
          .find((item) => label(item) === "clock out" && !item.disabled);
        if (confirm) return confirm;
        root = root.parentElement;
      }
    }
    return null;
  };
  if (action === "clock_out") {
    const existing = modalConfirm();
    if (existing) { existing.click(); return "clicked"; }
  }
  const clockIn = find(["clock in", "clock-in", "start work", "start tracking"]);
  const resume = find(["resume work"]);
  const pause = find(["take a break", "working away"]);
  const clockOut = find(["clock out", "clock-out"]);
  const current = clockIn ? "off_shift" : resume ? "paused" : (pause || clockOut) ? "active" : "unknown";
  const target = action === "clock_out" ? "off_shift"
    : action === "pause" ? "paused"
    : "active";
  if (current === target) return "already_target";
  if (current === "unknown") return "not_ready";
  const labels = {
    clock_in: ["clock in", "clock-in", "start work", "start tracking", "resume work"],
    clock_out: ["clock out", "clock-out"],
    pause: ["take a break", "working away"],
    resume: ["resume work"]
  };
  const button = find(labels[action]);
  if (!button || button.disabled) return "not_ready";
  button.click();
  if (action === "clock_out") {
    let sawModal = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const confirm = modalConfirm();
      if (confirm) { confirm.click(); return "clicked"; }
      if (confirm === null) sawModal = true;
    }
    if (sawModal) return "not_ready";
  }
  return "clicked";
})()
"@
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $last = "not_ready"
    while ((Get-Date) -lt $deadline) {
        $socket = $null
        $cancellation = $null
        try {
            $socket = New-Object System.Net.WebSockets.ClientWebSocket
            $cancellation = New-Object System.Threading.CancellationTokenSource
            $cancellation.CancelAfter([TimeSpan]::FromSeconds(5))
            $token = $cancellation.Token
            $null = $socket.ConnectAsync([Uri]$Target.webSocketDebuggerUrl, $token).GetAwaiter().GetResult()
            $payload = @{ id = 1; method = "Runtime.evaluate"; params = @{ expression = $expression; returnByValue = $true; awaitPromise = $true } } | ConvertTo-Json -Compress -Depth 6
            $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
            $segment = New-Object "System.ArraySegment[byte]" -ArgumentList @(, $bytes)
            $null = $socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $token).GetAwaiter().GetResult()
            $buffer = New-Object byte[] 65536
            $memory = New-Object System.IO.MemoryStream
            do {
                $receive = New-Object "System.ArraySegment[byte]" -ArgumentList @(, $buffer)
                $result = $socket.ReceiveAsync($receive, $token).GetAwaiter().GetResult()
                $memory.Write($buffer, 0, $result.Count)
            } while (-not $result.EndOfMessage)
            $response = [Text.Encoding]::UTF8.GetString($memory.ToArray()) | ConvertFrom-Json
            if ($response.id -eq 1 -and -not $response.error -and -not $response.result.exceptionDetails) {
                $last = [string]$response.result.result.value
                if ($last -eq "clicked" -or $last -eq "already_target") { return $last }
            }
        } catch {
            $last = "not_ready"
        } finally {
            if ($cancellation) { $cancellation.Dispose() }
            if ($socket) { $socket.Dispose() }
        }
        Start-Sleep -Milliseconds 500
    }
    return $last
}

try {
    $script:Executable = Find-WorktivityExecutable
    if (-not $script:Executable) {
        if ($Action -eq "finish") { Write-Result "restored" }
        Write-Result "not_installed" "Worktivity is not installed for this Windows user."
    }

    if ($Action -eq "finish") {
        $processes = @(Get-WorktivityProcesses $script:Executable)
        $debugProcesses = @($processes | Where-Object { $_.CommandLine -match '--remote-debugging-port(?:=|\s+)\d{2,5}' })
        if ($debugProcesses.Count -eq 0) { Write-Result "restored" }
        $debugPorts = @($debugProcesses | ForEach-Object {
            if ($_.CommandLine -match '--remote-debugging-port(?:=|\s+)(\d{2,5})') { [int]$Matches[1] }
        })
        if (@($debugPorts | Where-Object { $_ -ne $DefaultPort }).Count -eq 0) {
            # 9222 is the companion/watchdog control port. Keep it so the next
            # clock action reuses the live page instead of restarting the app.
            Write-Result "restored"
        }
        Stop-WorktivityForRestart $processes
        $null = Start-Process -FilePath $script:Executable -ErrorAction Stop
        $deadline = (Get-Date).AddSeconds(20)
        do {
            Start-Sleep -Milliseconds 250
            $restored = @(Get-WorktivityProcesses $script:Executable)
        } while ($restored.Count -eq 0 -and (Get-Date) -lt $deadline)
        if ($restored.Count -eq 0) { Write-Result "error" "Worktivity closed its local control port but did not reopen normally." }
        Write-Result "restored"
    }

    $processes = @(Get-WorktivityProcesses $script:Executable)
    $existing = Get-ExistingTarget $processes
    if ($existing) {
        try {
            $result = Invoke-CdpAction $existing.target $Action
            if ($result -eq "clicked" -or $result -eq "already_target") { Write-Result $result "" $false }
            if ($result -eq "not_ready") { Write-Result "not_ready" "Worktivity is responding, but its current page is not ready for this control." $false }
        } catch {
            # A stale CDP target is recoverable: restart once with a controlled
            # loopback port, then inspect the provider UI again before clicking.
        }
    }

    $wasRunning = $processes.Count -gt 0
    if ($wasRunning) { Stop-WorktivityForRestart $processes }
    $port = Get-AvailablePort
    if ($port -eq 0) {
        $null = Start-Process -FilePath $script:Executable -ErrorAction Stop
        Write-Result "not_ready" "Worktivity opened, but no free local control port is available."
    }
    $arguments = @("--remote-debugging-port=$port", "--remote-debugging-address=127.0.0.1")
    # Keep the default loopback control port for the next action. A non-default
    # port is temporary and is removed by finish_worktivity_control.
    $script:RestoreRequired = $port -ne $DefaultPort
    $null = Start-Process -FilePath $script:Executable -ArgumentList $arguments -PassThru -ErrorAction Stop

    $deadline = (Get-Date).AddSeconds(20)
    $target = @()
    do {
        Start-Sleep -Milliseconds 500
        $target = @(Get-Target $port)
    } while ($target.Count -eq 0 -and (Get-Date) -lt $deadline)
    if ($target.Count -eq 0) { Write-Result "not_ready" "Worktivity launched, but its local control page did not become ready." }

    $result = Invoke-CdpAction $target[0] $Action
    if ($result -eq "clicked" -or $result -eq "already_target") { Write-Result $result }
    Write-Result "not_ready" "Worktivity opened, but the requested clock control was not available."
} catch {
    Write-Result "error" "Worktivity could not be controlled: $($_.Exception.Message)"
}
