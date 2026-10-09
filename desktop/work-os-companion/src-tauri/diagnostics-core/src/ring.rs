//! Bounded, sequence-numbered history for the diagnostics window.
//!
//! The debugger reads history in pages instead of receiving the whole ring.
//! Every page is contiguous: `Before` and `After` return the entries nearest
//! the cursor, so a window the debugger holds never has holes in it.

use std::collections::VecDeque;

pub const PAGE_DEFAULT: usize = 50;
pub const PAGE_MAX: usize = 100;

#[derive(Clone, Debug, PartialEq)]
pub struct Entry<T> {
    pub seq: u64,
    pub value: T,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Anchor {
    Newest,
    Before(u64),
    After(u64),
}

#[derive(Debug)]
pub struct Page<T> {
    /// Newest first.
    pub entries: Vec<Entry<T>>,
    /// Matching entries exist newer than this page.
    pub has_newer: bool,
    /// Matching entries exist older than this page.
    pub has_older: bool,
    /// Matching entries held in the ring, regardless of the anchor.
    pub matching_total: usize,
    /// For `After`: matching entries newer than the cursor.
    pub matching_after: Option<usize>,
}

pub struct EventRing<T> {
    entries: VecDeque<Entry<T>>,
    capacity: usize,
    next_seq: u64,
}

impl<T: Clone> EventRing<T> {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: VecDeque::with_capacity(capacity),
            capacity,
            next_seq: 1,
        }
    }

    pub fn push(&mut self, value: T) -> u64 {
        let seq = self.next_seq;
        self.next_seq += 1;
        if self.entries.len() >= self.capacity {
            self.entries.pop_front();
        }
        self.entries.push_back(Entry { seq, value });
        seq
    }

    pub fn head_seq(&self) -> Option<u64> {
        self.entries.back().map(|entry| entry.seq)
    }

    pub fn page(&self, anchor: Anchor, limit: usize, matches: impl Fn(u64, &T) -> bool) -> Page<T> {
        let limit = limit.min(PAGE_MAX);
        let matched: Vec<&Entry<T>> = self
            .entries
            .iter()
            .filter(|entry| matches(entry.seq, &entry.value))
            .collect();
        let total = matched.len();

        match anchor {
            Anchor::After(after) => {
                let start = matched.partition_point(|entry| entry.seq <= after);
                let end = (start + limit).min(total);
                Page {
                    entries: collect_newest_first(&matched[start..end]),
                    has_newer: end < total,
                    has_older: start > 0,
                    matching_total: total,
                    matching_after: Some(total - start),
                }
            }
            Anchor::Newest | Anchor::Before(_) => {
                let end = match anchor {
                    Anchor::Before(before) => matched.partition_point(|entry| entry.seq < before),
                    _ => total,
                };
                let start = end.saturating_sub(limit);
                Page {
                    entries: collect_newest_first(&matched[start..end]),
                    has_newer: end < total,
                    has_older: start > 0,
                    matching_total: total,
                    matching_after: None,
                }
            }
        }
    }
}

fn collect_newest_first<T: Clone>(ascending: &[&Entry<T>]) -> Vec<Entry<T>> {
    ascending
        .iter()
        .rev()
        .map(|entry| (*entry).clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ring_of(count: u64) -> EventRing<u64> {
        let mut ring = EventRing::new(1000);
        for value in 1..=count {
            ring.push(value);
        }
        ring
    }

    fn seqs(page: &Page<u64>) -> Vec<u64> {
        page.entries.iter().map(|entry| entry.seq).collect()
    }

    #[test]
    fn assigns_increasing_sequence_numbers_and_evicts_the_oldest() {
        let mut ring = EventRing::new(3);
        assert_eq!(ring.push("a"), 1);
        assert_eq!(ring.push("b"), 2);
        assert_eq!(ring.push("c"), 3);
        assert_eq!(ring.push("d"), 4);
        let page = ring.page(Anchor::Newest, 10, |_, _| true);
        assert_eq!(
            page.entries.iter().map(|e| e.value).collect::<Vec<_>>(),
            vec!["d", "c", "b"]
        );
        assert!(!page.has_older);
    }

    #[test]
    fn newest_page_is_newest_first_and_reports_older_history() {
        let ring = ring_of(120);
        let page = ring.page(Anchor::Newest, 50, |_, _| true);
        assert_eq!(seqs(&page).first(), Some(&120));
        assert_eq!(seqs(&page).last(), Some(&71));
        assert_eq!(page.entries.len(), 50);
        assert!(page.has_older);
        assert!(!page.has_newer);
        assert_eq!(page.matching_total, 120);
        assert_eq!(page.matching_after, None);
    }

    #[test]
    fn before_pages_step_backward_without_holes() {
        let ring = ring_of(120);
        let first = ring.page(Anchor::Newest, 50, |_, _| true);
        let oldest_loaded = first.entries.last().unwrap().seq;
        let second = ring.page(Anchor::Before(oldest_loaded), 50, |_, _| true);
        assert_eq!(seqs(&second).first(), Some(&70));
        assert_eq!(seqs(&second).last(), Some(&21));
        assert!(second.has_newer);
        assert!(second.has_older);
    }

    #[test]
    fn after_pages_return_the_nearest_entries_above_the_cursor() {
        let ring = ring_of(300);
        let page = ring.page(Anchor::After(100), 50, |_, _| true);
        assert_eq!(seqs(&page).first(), Some(&150));
        assert_eq!(seqs(&page).last(), Some(&101));
        assert!(page.has_newer);
        assert!(page.has_older);
        assert_eq!(page.matching_after, Some(200));
    }

    #[test]
    fn after_cursor_at_the_head_returns_nothing_newer() {
        let ring = ring_of(40);
        let page = ring.page(Anchor::After(40), 50, |_, _| true);
        assert!(page.entries.is_empty());
        assert!(!page.has_newer);
        assert_eq!(page.matching_after, Some(0));
    }

    #[test]
    fn filters_apply_across_the_whole_ring_not_only_the_page() {
        let ring = ring_of(1000);
        let page = ring.page(Anchor::Newest, 50, |_, value| *value == 3);
        assert_eq!(seqs(&page), vec![3]);
        assert_eq!(page.matching_total, 1);
        assert!(!page.has_older);
    }

    #[test]
    fn sequence_floor_bounds_newest_and_older_pages() {
        let ring = ring_of(1000);
        let floor = 900;
        let newest = ring.page(Anchor::Newest, 50, |seq, _| seq > floor);
        assert_eq!(seqs(&newest).first(), Some(&1000));
        assert_eq!(seqs(&newest).last(), Some(&951));
        assert!(newest.has_older);

        let older = ring.page(Anchor::Before(951), 50, |seq, _| seq > floor);
        assert_eq!(seqs(&older).first(), Some(&950));
        assert_eq!(seqs(&older).last(), Some(&901));
        assert!(!older.has_older);
    }

    #[test]
    fn a_cursor_older_than_the_ring_returns_an_empty_page() {
        let mut ring = EventRing::new(5);
        for value in 1..=20u64 {
            ring.push(value);
        }
        let page = ring.page(Anchor::Before(3), 50, |_, _| true);
        assert!(page.entries.is_empty());
        assert!(!page.has_older);
    }

    #[test]
    fn limits_are_capped_at_the_maximum_page_size() {
        let ring = ring_of(1000);
        let page = ring.page(Anchor::Newest, 10_000, |_, _| true);
        assert_eq!(page.entries.len(), PAGE_MAX);
    }
}
