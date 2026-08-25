#!/usr/bin/env python3
"""
check_contract.py - prove the frontend and backend agree on the API surface.

Neither side can be executed in a sandbox without network access (PyPI and npm
are both blocked), so this compares them statically instead:

  * the backend is read with Python's own `ast` module, so no FastAPI import is
    needed - router prefixes come from `APIRouter(prefix=...)` assignments and
    paths from `@<router>.<method>("...")` decorators;
  * the frontend is read from src/api/endpoints.js, the single file that holds
    every call the UI can make.

Both sides are normalised so a path parameter compares equal regardless of its
name: backend "/{request_id}" and frontend "/${id}" both become "/:p".

Two findings are reported:

  ERROR - the frontend calls a route the backend does not serve. This is a
          guaranteed 404 at runtime and fails the check.
  NOTE  - the backend serves a route the frontend never calls. Usually fine
          (some endpoints exist for the API docs or a future screen), so this is
          informational only.

Usage: python3 tools/check_contract.py [--verbose]
Exit code 1 if any frontend call has no backend route.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROUTES_DIR = ROOT / "backend" / "app" / "routes"
ENDPOINTS_JS = ROOT / "frontend" / "src" / "api" / "endpoints.js"

VERBOSE = "--verbose" in sys.argv

HTTP_METHODS = {"get", "post", "patch", "put", "delete"}
# The frontend client names DELETE "del" so it does not shadow the keyword.
JS_METHOD_ALIASES = {"del": "delete"}

PARAM = ":p"


def normalise(path: str) -> str:
    """Collapse path parameters and trailing slashes so both sides compare."""
    # Order matters: "${id}" must be consumed before the bare "{...}" rule, or
    # the leading "$" survives and every templated path fails to match.
    path = re.sub(r"\$\{[^}]*\}", PARAM, path)  # frontend /${id}
    path = re.sub(r"\{[^}]*\}", PARAM, path)   # backend  /{request_id}
    if len(path) > 1:
        path = path.rstrip("/")
    return path or "/"


# --------------------------------------------------------------------------- #
# Backend                                                                     #
# --------------------------------------------------------------------------- #


def backend_routes() -> dict[tuple[str, str], str]:
    """Map (METHOD, path) -> "file:line" for every declared route."""
    routes: dict[tuple[str, str], str] = {}

    for source in sorted(ROUTES_DIR.glob("*.py")):
        tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))

        # 1. router variable -> prefix
        prefixes: dict[str, str] = {}
        for node in ast.walk(tree):
            if not isinstance(node, ast.Assign):
                continue
            value = node.value
            if not isinstance(value, ast.Call):
                continue
            func = value.func
            name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", "")
            if name != "APIRouter":
                continue
            prefix = ""
            for kw in value.keywords:
                if kw.arg == "prefix" and isinstance(kw.value, ast.Constant):
                    prefix = kw.value.value
            for target in node.targets:
                if isinstance(target, ast.Name):
                    prefixes[target.id] = prefix

        # 2. decorated route handlers
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for deco in node.decorator_list:
                if not isinstance(deco, ast.Call):
                    continue
                func = deco.func
                if not isinstance(func, ast.Attribute):
                    continue
                if func.attr not in HTTP_METHODS:
                    continue
                if not isinstance(func.value, ast.Name):
                    continue
                router_var = func.value.id
                if router_var not in prefixes:
                    continue
                if not deco.args or not isinstance(deco.args[0], ast.Constant):
                    continue

                path = prefixes[router_var] + deco.args[0].value
                key = (func.attr.upper(), normalise(path))
                routes[key] = f"{source.name}:{node.lineno}"

    return routes


# --------------------------------------------------------------------------- #
# Frontend                                                                    #
# --------------------------------------------------------------------------- #

CALL_RE = re.compile(
    r"""api\.(get|post|patch|put|del)\(\s*(?:"([^"]+)"|`([^`]+)`)""",
    re.VERBOSE,
)


def frontend_calls() -> dict[tuple[str, str], int]:
    """Map (METHOD, path) -> line number for every call the UI can make."""
    calls: dict[tuple[str, str], int] = {}
    text = ENDPOINTS_JS.read_text(encoding="utf-8")

    for match in CALL_RE.finditer(text):
        method = match.group(1)
        method = JS_METHOD_ALIASES.get(method, method).upper()
        path = match.group(2) or match.group(3)
        line = text.count("\n", 0, match.start()) + 1
        calls[(method, normalise(path))] = line

    return calls


# --------------------------------------------------------------------------- #

def main() -> int:
    if not ROUTES_DIR.is_dir():
        print(f"cannot find backend routes at {ROUTES_DIR}")
        return 1
    if not ENDPOINTS_JS.is_file():
        print(f"cannot find {ENDPOINTS_JS}")
        return 1

    routes = backend_routes()
    calls = frontend_calls()

    missing = sorted(key for key in calls if key not in routes)
    unused = sorted(key for key in routes if key not in calls)

    print(f"backend routes declared : {len(routes)}")
    print(f"frontend calls declared : {len(calls)}")
    print()

    if VERBOSE:
        for (method, path), line in sorted(calls.items()):
            mark = "ok " if (method, path) in routes else "ERR"
            print(f"  {mark} {method:6} {path}  (endpoints.js:{line})")
        print()

    if unused:
        print(f"NOTE: {len(unused)} backend route(s) the frontend never calls:")
        for method, path in unused:
            print(f"  - {method:6} {path}   [{routes[(method, path)]}]")
        print()

    if missing:
        print(f"ERROR: {len(missing)} frontend call(s) with no backend route:")
        for method, path in missing:
            print(f"  x {method:6} {path}   (endpoints.js:{calls[(method, path)]})")
        return 1

    print("PASS: every frontend call maps to a declared backend route.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
