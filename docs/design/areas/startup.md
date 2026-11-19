# Startup and the local vault gate

**Use when:** Changing launch loading, vault open/failure/retry/reset, or the ready-content handoff.

**Owns:** Truthful boot phases, bounded recovery actions, and First Light motion.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing shared mascot artwork: [Floating companion, Otto, and assets](floating-companion.md).
- Changing loading or handoff motion: [Motion and reduced motion](../patterns/motion.md).

**Implementation starting points:** [LoadingUi.tsx](../../../desktop/work-os-companion/src/LoadingUi.tsx), [BootHandoff.tsx](../../../desktop/work-os-companion/src/BootHandoff.tsx), [vaultGate.ts](../../../desktop/work-os-companion/src/vaultGate.ts).

The companion keeps this device's session, queued updates, and cached workday in
an encrypted local vault, and the vault's key lives in the OS credential store.
That read can wait on a system dialog — on macOS an in-place update changes the
app's ad-hoc signature, so the saved Keychain item no longer matches the new
build — so the gate that holds every screen until the vault opens always settles:

| Gate state | Surface |
|---|---|
| Opening | Loading screen: the companion in his working pose, heading, the real stage line, the bench pulse, no recovery controls |
| Opened | The workspace, or whatever screen the workspace itself requires next |
| Failed | Failure screen: the bounded reason as its explanation, `Retry`, and `Start fresh on this device` for an unreadable stored key, a confirmed `BadFileKey` decryption failure, or a host-reported lost open |

The opening screen is one persistent overlay across the vault and day-read
phases — only the stage line changes between them. It exits through the
Morning Rise choreography below once the next surface holds real content,
never on a timer.

The gate never offers an action it cannot honor. An offline bypass appears only
on surfaces that can actually run offline; `Start fresh` arms on the first click
and runs on the second, because it discards this device's local data, and its
hint names what is replaced and what stays. A retry retires the previous attempt,
so an answer that arrives late — a system dialog the employee finally allowed —
can never jump past the screen in front of them. A failed gate is a boot phase of
its own (`boot:vault_failed`), so a launch that stopped before the workspace is
never reported as a crash, and the packaged-Mac startup gate asserts the app
reaches a phase past its loading screen.

A `BadFileKey` verdict means the available key did not decrypt the local copy,
not that the cause of the mismatch is known or that a Keychain dialog is still
pending. Its explanation names sign-out and loss of unsent queued updates;
unknown, timed-out, and transient startup errors never gain this reset option
from their generic messages. No error classification itself replaces data.

## First Light and Morning Rise

The companion's boot overlay (First Light) carries the launch wait: the bench
pulse crossing every 3.4s with a ~600ms rest, and the glow breathing at low
amplitude — the surface's two purposeful loops, the loading-wait exception to
the no-ambient-loops rule. When the next surface holds real content, the
handoff plays once: the pulse lands within 300ms (skipped under reduced
motion), then the night lifts 8px and fades over 640ms with the product
easing while the workspace rises 8px and fades in; reduced motion gets a
single 150ms opacity fade. The exit starts only when the data is really
ready — never a fixed delay.
