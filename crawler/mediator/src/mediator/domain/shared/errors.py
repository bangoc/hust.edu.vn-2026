from __future__ import annotations


class ConfigError(ValueError):
    """A configuration file is missing a value or holds one that cannot be used."""
