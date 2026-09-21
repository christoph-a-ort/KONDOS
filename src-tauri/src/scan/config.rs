use crate::error::AppError;
use crate::filter::normalize_extensions;
use crate::model::{ScanConfig, MAX_DEPTH, MIN_DEPTH};

impl ScanConfig {
    pub fn validated(mut self) -> Result<Self, AppError> {
        let root_path = self.root_path.trim();
        if root_path.is_empty() {
            return Err(AppError::invalid_path(
                "Bitte wählen Sie ein Startverzeichnis.",
            ));
        }
        self.root_path = root_path.to_string();

        if !(MIN_DEPTH..=MAX_DEPTH).contains(&self.max_depth) {
            return Err(AppError::invalid_config(format!(
                "Die Tiefe muss zwischen {MIN_DEPTH} und {MAX_DEPTH} liegen."
            )));
        }

        self.extensions = normalize_extensions(&self.extensions);
        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use crate::model::{ScanConfig, DEFAULT_DEPTH, MAX_DEPTH, MIN_DEPTH};

    fn sample() -> ScanConfig {
        ScanConfig {
            root_path: "C:/data".into(),
            max_depth: DEFAULT_DEPTH,
            exclude_hidden: true,
            extensions: vec!["PDF".into(), ".png".into(), "pdf".into()],
            include_size: false,
            include_created_at: false,
            include_modified_at: false,
        }
    }

    #[test]
    fn rejects_empty_path() {
        let mut config = sample();
        config.root_path = "  ".into();
        assert!(config.validated().is_err());
    }

    #[test]
    fn rejects_depth_out_of_range() {
        let mut low = sample();
        low.max_depth = 0;
        assert!(low.validated().is_err());

        let mut high = sample();
        high.max_depth = 33;
        assert!(high.validated().is_err());
    }

    #[test]
    fn accepts_bounds_and_normalizes_extensions() {
        let mut config = sample();
        config.max_depth = 1;
        let validated = config.validated().expect("valid");
        assert_eq!(validated.extensions, vec![".pdf", ".png"]);
    }

    #[test]
    fn default_and_max_depth_are_valid() {
        assert_eq!(DEFAULT_DEPTH, 16);
        assert_eq!(MIN_DEPTH, 1);
        assert_eq!(MAX_DEPTH, 32);
        for depth in [MIN_DEPTH, DEFAULT_DEPTH, MAX_DEPTH] {
            let mut config = sample();
            config.max_depth = depth;
            assert!(config.validated().is_ok(), "depth {depth}");
        }
    }
}
