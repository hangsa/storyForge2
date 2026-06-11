import re

# --- SF_LOG top-level extraction ---
# Matches: <!-- SF_LOG type_name key="value" ... -->
SF_LOG_PATTERN = re.compile(r"<!-- SF_LOG (\w+) (.*?) -->", re.DOTALL)

# --- Parameter extraction ---
# Matches: key="value" or key='value' pairs within SF_LOG tags
PARAM_PATTERN = re.compile(r"""(\w+)=("[^"]*"|'[^']*')""")

# --- Format validation ---
# Strict format check: type name + space + one or more key="value" pairs
FORMAT_CHECK_PATTERN = re.compile(
    r"<!-- SF_LOG \w+ (?:[\w-]+=\"[^\"]*\"\s*)+ -->"
)

# --- Valid SF_LOG types (11 for v1.5) ---
VALID_LOG_TYPES = {
    "character_emotion",
    "character_relation_change",
    "character_location_change",
    "character_physical_change",
    "knowledge_gain",
    "conflict_escalate",
    "mystery_clue",
    "twist_reveal",
    "expectation_fulfill",
    "goal_milestone",
    "registry_create",
}

# --- Fact Guard Check 1: timeline continuity ---
LOCATION_CHANGE_PATTERN = re.compile(
    r'<!-- SF_LOG character_location_change char="(\w+)" from="([^"]*)" to="([^"]*)" -->'
)

# Matches Chinese location descriptions in narrative text
LOCATION_MENTION_PATTERN = re.compile(
    r'(?:位于|在|来到|到达|回到|进入|离开)([""][^""]*[""]|[^\s，。；,.;]+)'
)

# --- Fact Guard Check 3: world rules ---
# Matches power/ability usage descriptions in Chinese text
POWER_USAGE_PATTERN = re.compile(
    r"(?:发动|释放|施展|使用|启动)(?:\w+·)?(\w+(?:\s*\w+)*)"
)

# Matches cost declarations via SF_LOG
COST_DECLARATION_PATTERN = re.compile(
    r"<!-- SF_LOG registry_create type=\"cost\" data='(\{[^}]*\})' -->"
)

# --- Fact Guard Check 4: asset compliance ---
# Matches registry asset ID references (cf_001, mys_002, tw_003, goal_004)
ASSET_REF_PATTERN = re.compile(r"(cf_\d+|mys_\d+|tw_\d+|goal_\d+)")
