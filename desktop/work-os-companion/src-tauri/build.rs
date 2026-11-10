fn main() {
    // Embed source identity at build time, not from the machine running the app.
    println!("cargo:rerun-if-changed=build.rs");
    if let Ok(output) = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
    {
        let commit = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        if output.status.success()
            && commit.len() == 40
            && commit.bytes().all(|b| b.is_ascii_hexdigit())
        {
            println!("cargo:rustc-env=WORK_OS_BUILD_COMMIT={commit}");
        }
    }
    // Worktrees store HEAD and branch refs outside the checkout. Track both so
    // incremental local builds cannot retain the previous commit's identity.
    for reference in ["HEAD", "refs/heads"] {
        if let Ok(output) = std::process::Command::new("git")
            .args(["rev-parse", "--git-path", reference])
            .output()
        {
            if output.status.success() {
                println!(
                    "cargo:rerun-if-changed={}",
                    String::from_utf8_lossy(&output.stdout).trim()
                );
            }
        }
    }
    tauri_build::build()
}
