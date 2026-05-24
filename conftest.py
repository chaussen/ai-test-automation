import pytest


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    """Make all browser contexts ignore HTTPS certificate errors (sandbox-safe)."""
    return {**browser_context_args, "ignore_https_errors": True}
