Extract what was LEARNED in this teaching exchange about "{{topic}}".
Only extract if something meaningful was actually taught.

Return JSON:
{
  "shouldSave":  boolean,
  "topic":       "specific topic string",
  "content":     "clear summary of what was learned (2-3 sentences)",
  "chunkType":   "taught | corrected | recalled | reinforced",
  "confidence":  0-1
}

Return shouldSave: false if the exchange was just small talk or too vague.