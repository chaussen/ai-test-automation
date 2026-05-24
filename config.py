import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.deepseek.com")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "deepseek-chat")

BASE_DIR = Path(__file__).parent
STORIES_DIR = BASE_DIR / "stories"
OUTPUT_DIR = BASE_DIR / "output"

for _d in [OUTPUT_DIR / "test_cases", OUTPUT_DIR / "scripts", OUTPUT_DIR / "reports"]:
    _d.mkdir(parents=True, exist_ok=True)
