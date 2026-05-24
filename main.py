"""
Entry point for the test automation agent.

Usage:
  python main.py <story_name>      Run the full workflow for one story
  python main.py --list            Show available stories
  python main.py --watch           Watch stories/ and auto-trigger on new files
  python main.py --watch <dir>     Watch a custom directory
"""

import asyncio
import sys
from pathlib import Path

import config
from orchestrator import run_agent

STORIES_DIR = config.STORIES_DIR
WATCH_INTERVAL = 5  # seconds between polls


def _list_stories() -> None:
    stories = sorted(STORIES_DIR.glob("*.md"))
    if not stories:
        print("No stories found in stories/")
        return
    print("Available stories:")
    for s in stories:
        print(f"  {s.stem}")


async def _watch(watch_dir: Path) -> None:
    print(f"[watcher] watching {watch_dir}/ every {WATCH_INTERVAL}s  (Ctrl+C to stop)\n")
    processed: set[Path] = set(watch_dir.glob("*.md"))

    while True:
        await asyncio.sleep(WATCH_INTERVAL)
        current = set(watch_dir.glob("*.md"))
        new_files = current - processed
        for path in sorted(new_files):
            print(f"[watcher] new story detected: {path.stem}")
            try:
                await run_agent(path.stem)
            except Exception as exc:
                print(f"[watcher] error processing {path.stem}: {exc}")
            processed.add(path)


def main() -> None:
    args = sys.argv[1:]

    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        _list_stories()
        return

    if args[0] == "--list":
        _list_stories()
        return

    if args[0] == "--watch":
        watch_dir = Path(args[1]) if len(args) > 1 else STORIES_DIR
        if not watch_dir.is_dir():
            print(f"ERROR: {watch_dir} is not a directory")
            sys.exit(1)
        try:
            asyncio.run(_watch(watch_dir))
        except KeyboardInterrupt:
            print("\n[watcher] stopped.")
        return

    # Default: run a named story
    story_name = args[0]
    asyncio.run(run_agent(story_name))


if __name__ == "__main__":
    main()
