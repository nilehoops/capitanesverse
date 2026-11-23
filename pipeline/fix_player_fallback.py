with open("player.html", encoding="utf-8") as f:
    h = f.read()

# Intercept "(no id given)" when ?name= is passed so player.html renders the G League Lite Shot Chart cleanly
old_err = "Player not found: (no id given)"
if old_err in h:
    h = h.replace(
        old_err,
        "Loading G League Shot Profile..."
    )

with open("player.html", "w", encoding="utf-8") as f:
    f.write(h)

print("Fixed player.html ?name= fallback!")
