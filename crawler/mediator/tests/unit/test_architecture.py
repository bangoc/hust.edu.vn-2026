from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).parents[2]
SRC = ROOT / "src"
PACKAGE = SRC / "mediator"
# Layer first, then context: mediator.<layer>.<context>...; cli.py and bootstrap.py sit at the top.
LAYERS = ("domain", "application", "infrastructure")
RANK = {layer: index for index, layer in enumerate(LAYERS)}
CONTEXTS = frozenset({"controller"})
SHARED = "shared"
OUTER = frozenset({"cli", "api"})
BOOTSTRAP = "bootstrap"
IO_MODULES = frozenset(
    {"sqlite3", "aiohttp", "subprocess", "shutil", "tempfile", "os", "yaml", "socket"}
)


def module_name(path: Path) -> str:
    parts = path.relative_to(SRC).with_suffix("").parts
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


def imported_modules(path: Path) -> set[str]:
    imported: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            imported.add(node.module)
            imported.update(f"{node.module}.{alias.name}" for alias in node.names)
    return imported


def placement(module: str) -> tuple[str | None, str | None]:
    parts = module.split(".")
    layer = parts[1] if len(parts) > 1 else None
    context = parts[2] if len(parts) > 2 and layer in RANK else None
    return layer, context


def allowed(importer: str, imported: str) -> bool:
    """Whether ``importer`` may import ``imported`` (both dotted module names)."""
    if not imported.startswith("mediator."):
        return True
    layer, context = placement(importer)
    target_layer, target_context = placement(imported)
    if layer == BOOTSTRAP:
        return target_layer not in OUTER
    if layer in OUTER:
        launches = layer == "cli" and target_layer == "api"
        return target_layer != "infrastructure" and (
            launches or target_layer not in OUTER - {layer}
        )
    if target_layer in OUTER or target_layer == BOOTSTRAP:
        return False
    if layer not in RANK or target_layer not in RANK:
        return False
    if target_context is not None and target_context not in {context, SHARED}:
        return False
    if context == SHARED and target_context not in {SHARED, None}:
        return False
    if layer == "infrastructure" and target_layer == "application":
        ports = f"mediator.application.{context}.ports"
        return imported == ports or imported.startswith(f"{ports}.")
    return RANK[target_layer] <= RANK[layer]


def all_modules() -> list[tuple[str, Path]]:
    return [(module_name(path), path) for path in sorted(PACKAGE.rglob("*.py"))]


def is_stray(module: str) -> bool:
    depth = module.count(".")
    layer, context = placement(module)
    if depth == 0:
        return False
    if depth == 1:
        return layer not in {*LAYERS, *OUTER, BOOTSTRAP}
    if layer in OUTER:
        return False
    return layer not in RANK or context not in CONTEXTS | {SHARED}


def test_dependency_rule() -> None:
    violations = [
        f"{module} -> {imported}"
        for module, path in all_modules()
        for imported in sorted(imported_modules(path))
        if not allowed(module, imported)
    ]
    assert violations == []


def test_domain_modules_do_no_io() -> None:
    violations = [
        f"{module} -> {imported}"
        for module, path in all_modules()
        if placement(module)[0] == "domain"
        for imported in sorted(imported_modules(path))
        if imported.split(".")[0] in IO_MODULES
    ]
    assert violations == []


def test_every_module_sits_in_a_layer_and_a_context() -> None:
    assert [module for module, _ in all_modules() if is_stray(module)] == []


def test_rules_point_inwards() -> None:
    assert allowed(
        "mediator.application.controller.dispatch", "mediator.domain.controller.rotation"
    )
    assert not allowed(
        "mediator.domain.controller.rotation", "mediator.application.controller.dispatch"
    )
    assert not allowed("mediator.api.server", "mediator.infrastructure.controller.sqlite_queue")
    assert allowed("mediator.bootstrap", "mediator.infrastructure.controller.sqlite_queue")
    assert allowed("mediator.cli", "mediator.api.server")
    assert not allowed("mediator.api.server", "mediator.cli")
    assert not allowed(
        "mediator.infrastructure.controller.sqlite_queue",
        "mediator.application.controller.dispatch",
    )
