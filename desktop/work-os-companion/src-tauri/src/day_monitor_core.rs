use std::collections::HashMap;

const LEASE_MS: u64 = 30_000;

struct Claim {
    scope: String,
    priority: u8,
    at: u64,
}

/// Host-owned arbitration, shared by webviews (never a JavaScript singleton).
#[derive(Default)]
pub struct DayMonitor {
    claims: HashMap<String, Claim>,
    snapshots: HashMap<String, String>,
}

impl DayMonitor {
    fn expire(&mut self, now: u64) {
        self.claims
            .retain(|_, claim| now.saturating_sub(claim.at) < LEASE_MS);
        self.snapshots
            .retain(|scope, _| self.claims.values().any(|claim| &claim.scope == scope));
    }

    fn owner(&self, scope: &str) -> Option<&str> {
        self.claims
            .iter()
            .filter(|(_, claim)| claim.scope == scope && claim.priority > 0)
            .max_by(|(left_window, left), (right_window, right)| {
                left.priority
                    .cmp(&right.priority)
                    .then_with(|| right_window.cmp(left_window))
            })
            .map(|(window, _)| window.as_str())
    }

    pub fn claim(&mut self, scope: &str, window: &str, priority: u8, now: u64) -> bool {
        self.expire(now);
        self.claims.insert(
            window.to_owned(),
            Claim {
                scope: scope.to_owned(),
                priority,
                at: now,
            },
        );
        self.snapshots
            .retain(|key, _| self.claims.values().any(|claim| &claim.scope == key));
        self.owner(scope) == Some(window)
    }

    pub fn publish(&mut self, scope: &str, window: &str, snapshot: &str, now: u64) -> bool {
        self.expire(now);
        if self.owner(scope) != Some(window) {
            return false;
        }
        self.snapshots.insert(scope.to_owned(), snapshot.to_owned());
        true
    }

    pub fn snapshot(&mut self, scope: &str, window: &str, now: u64) -> Option<String> {
        self.expire(now);
        if self.claims.get(window).map(|claim| claim.scope.as_str()) != Some(scope) {
            return None;
        }
        self.snapshots.get(scope).cloned()
    }

    pub fn release(&mut self, scope: &str, window: &str) {
        if self.claims.get(window).map(|claim| claim.scope.as_str()) == Some(scope) {
            self.claims.remove(window);
        }
        self.snapshots
            .retain(|scope, _| self.claims.values().any(|claim| &claim.scope == scope));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_owner_across_windows_with_visibility_priority_and_expiry() {
        let mut state = DayMonitor::default();
        assert!(state.claim("scope", "main", 30, 0));
        assert!(!state.claim("scope", "avatar", 20, 1));
        assert!(state.publish("scope", "main", "snapshot", 2));
        assert_eq!(
            state.snapshot("scope", "avatar", 3),
            Some("snapshot".to_owned())
        );
        assert!(!state.claim("scope", "main", 10, 4));
        assert!(state.claim("scope", "avatar", 20, 5));
        assert!(!state.publish("scope", "main", "late", 6));
        // Missing or crashed avatar expires; a hidden main keeps reminders alive.
        assert!(state.claim("scope", "main", 10, 40_000));
        assert!(state.publish("scope", "main", "recovered", 40_001));
    }

    #[test]
    fn account_changes_and_recreated_windows_do_not_inherit_old_snapshots() {
        let mut state = DayMonitor::default();
        state.claim("old", "main", 30, 0);
        state.publish("old", "main", "private", 1);
        state.claim("new", "main", 30, 2);
        assert_eq!(state.snapshot("old", "main", 3), None);
        assert_eq!(state.snapshot("new", "main", 3), None);
        assert!(!state.publish("old", "main", "late", 4));
        state.claim("new", "avatar", 20, 5);
        state.release("old", "main");
        assert!(state.claim("new", "main", 30, 6));
        state.release("new", "main");
        assert!(state.claim("new", "avatar", 20, 6));
        assert!(state.publish("new", "avatar", "new data", 7));
        assert_eq!(
            state.snapshot("new", "avatar", 8),
            Some("new data".to_owned())
        );
    }
}
