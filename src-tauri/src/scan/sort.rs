use std::cmp::Ordering;

use crate::model::FsNode;

/// Basissortierung der Kinder eines Ordners.
/// Ordner vor Dateien, danach Natural Sort (case-insensitive, Zahlen natürlich).
/// Tie-Breaker: Originalname, dann Pfad — unabhängig von `read_dir`.
pub fn sort_children(children: &mut [FsNode]) {
    children.sort_by(cmp_nodes);
}

fn cmp_nodes(left: &FsNode, right: &FsNode) -> Ordering {
    kind_rank(left)
        .cmp(&kind_rank(right))
        .then_with(|| natural_cmp(node_name(left), node_name(right)))
        .then_with(|| node_name(left).cmp(node_name(right)))
        .then_with(|| node_path(left).cmp(node_path(right)))
}

fn kind_rank(node: &FsNode) -> u8 {
    match node {
        FsNode::Directory { .. } => 0,
        FsNode::File { .. } => 1,
    }
}

fn node_name(node: &FsNode) -> &str {
    match node {
        FsNode::Directory { name, .. } | FsNode::File { name, .. } => name,
    }
}

fn node_path(node: &FsNode) -> &str {
    match node {
        FsNode::Directory { path, .. } | FsNode::File { path, .. } => path,
    }
}

/// Dateiname Natural-Sort, Tie-Breaker Originalname, danach Pfad.
/// Dieselbe Vergleichsbasis wie die Scanner-Kindersortierung, ohne Ordner-vor-Dateien.
pub(crate) fn cmp_name_then_path(
    left_name: &str,
    left_path: &str,
    right_name: &str,
    right_path: &str,
) -> Ordering {
    natural_cmp(left_name, right_name)
        .then_with(|| left_name.cmp(right_name))
        .then_with(|| left_path.cmp(right_path))
}

fn natural_cmp(left: &str, right: &str) -> Ordering {
    let left_fold: String = left.chars().flat_map(char::to_lowercase).collect();
    let right_fold: String = right.chars().flat_map(char::to_lowercase).collect();
    natural_cmp_folded(&left_fold, &right_fold)
}

fn natural_cmp_folded(left: &str, right: &str) -> Ordering {
    let mut left_chars = left.chars().peekable();
    let mut right_chars = right.chars().peekable();

    loop {
        match (left_chars.peek().copied(), right_chars.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(left_ch), Some(right_ch))
                if left_ch.is_ascii_digit() && right_ch.is_ascii_digit() =>
            {
                let left_digits = take_ascii_digits(&mut left_chars);
                let right_digits = take_ascii_digits(&mut right_chars);
                match cmp_digit_runs(&left_digits, &right_digits) {
                    Ordering::Equal => {}
                    other => return other,
                }
            }
            (Some(left_ch), Some(right_ch)) => {
                left_chars.next();
                right_chars.next();
                match left_ch.cmp(&right_ch) {
                    Ordering::Equal => {}
                    other => return other,
                }
            }
        }
    }
}

fn take_ascii_digits(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut digits = String::new();
    while let Some(ch) = chars.peek().copied() {
        if !ch.is_ascii_digit() {
            break;
        }
        digits.push(ch);
        chars.next();
    }
    digits
}

fn cmp_digit_runs(left: &str, right: &str) -> Ordering {
    let left_sig = significant_digits(left);
    let right_sig = significant_digits(right);
    left_sig
        .len()
        .cmp(&right_sig.len())
        .then_with(|| left_sig.cmp(right_sig))
        .then_with(|| left.len().cmp(&right.len()))
}

fn significant_digits(digits: &str) -> &str {
    let trimmed = digits.trim_start_matches('0');
    if trimmed.is_empty() {
        "0"
    } else {
        trimmed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::FsNode;

    fn file(name: &str) -> FsNode {
        node(name, false)
    }

    fn dir(name: &str) -> FsNode {
        node(name, true)
    }

    fn node(name: &str, directory: bool) -> FsNode {
        if directory {
            FsNode::Directory {
                id: name.to_string(),
                name: name.to_string(),
                path: format!("/tmp/{name}"),
                depth: 1,
                listing: crate::model::DirectoryListing::Read,
                children: Vec::new(),
                size_bytes: None,
                created_at_ms: None,
                modified_at_ms: None,
            }
        } else {
            FsNode::File {
                id: name.to_string(),
                name: name.to_string(),
                path: format!("/tmp/{name}"),
                depth: 1,
                size_bytes: None,
                created_at_ms: None,
                modified_at_ms: None,
            }
        }
    }

    fn names(nodes: &[FsNode]) -> Vec<&str> {
        nodes.iter().map(node_name).collect()
    }

    #[test]
    fn directories_before_files() {
        let mut children = vec![file("a.txt"), dir("z"), file("b.txt"), dir("m")];
        sort_children(&mut children);
        assert_eq!(names(&children), vec!["m", "z", "a.txt", "b.txt"]);
    }

    #[test]
    fn natural_sort_folders_bilder_2_before_10() {
        let mut children = vec![dir("Bilder 10"), dir("Bilder 2")];
        sort_children(&mut children);
        assert_eq!(names(&children), vec!["Bilder 2", "Bilder 10"]);
    }

    #[test]
    fn natural_sort_files_2_before_10() {
        let mut children = vec![
            file("Datei 10.pdf"),
            file("Datei 20.pdf"),
            file("Datei 1.pdf"),
            file("Datei 2.pdf"),
        ];
        sort_children(&mut children);
        assert_eq!(
            names(&children),
            vec!["Datei 1.pdf", "Datei 2.pdf", "Datei 10.pdf", "Datei 20.pdf"]
        );
    }

    #[test]
    fn case_is_ignored_for_primary_order() {
        let mut children = vec![file("b.txt"), file("A.txt"), file("c.txt")];
        sort_children(&mut children);
        assert_eq!(names(&children), vec!["A.txt", "b.txt", "c.txt"]);
    }

    #[test]
    fn tie_breaker_is_deterministic_for_equal_folded_names() {
        let mut first = vec![file("Readme"), file("README"), file("readme")];
        let mut second = vec![file("readme"), file("Readme"), file("README")];
        sort_children(&mut first);
        sort_children(&mut second);
        assert_eq!(names(&first), names(&second));
        assert_eq!(names(&first), vec!["README", "Readme", "readme"]);
    }

    #[test]
    fn unicode_names_sort_without_panic() {
        let mut children = vec![
            file("文件.txt"),
            file("äpfel.txt"),
            file("zeta.txt"),
            file("📄 notes.txt"),
            dir("Österreich"),
            dir("alpha"),
        ];
        sort_children(&mut children);
        let ordered = names(&children);
        assert_eq!(ordered.len(), 6);
        assert_eq!(ordered[0], "alpha");
        assert_eq!(ordered[1], "Österreich");
        assert!(ordered[2..].contains(&"äpfel.txt"));
        assert!(ordered[2..].contains(&"zeta.txt"));
        let mut again = vec![
            file("📄 notes.txt"),
            dir("alpha"),
            file("zeta.txt"),
            file("äpfel.txt"),
            dir("Österreich"),
            file("文件.txt"),
        ];
        sort_children(&mut again);
        assert_eq!(names(&children), names(&again));
    }
}
