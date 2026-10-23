from pathlib import Path

path = Path("/etc/nginx/sites-available/market_dashboard_website.conf")
text = path.read_text()
snippet = """
    location = /open-mom-briefing {
        root /var/www/market_dashboard_website;
        try_files /open-mom-briefing.html =404;
        default_type text/html;
        add_header Cache-Control "no-store";
    }

"""
if "location = /open-mom-briefing" in text:
    print("already present")
else:
    needle = "    location / {"
    if needle not in text:
        raise SystemExit("location / not found")
    path.write_text(text.replace(needle, snippet + needle, 1))
    print("inserted")
