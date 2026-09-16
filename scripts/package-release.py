"""Build a reproducible, allowlisted skill ZIP and checksum for GitHub Releases."""
from hashlib import sha256
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parents[1]
output = root / "dist"
output.mkdir(exist_ok=True)
archive_path = output / "lolskills-scan.zip"
with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
    for name in ("SKILL.md", "scripts/check-skill.mjs", "README.md", "LICENSE", "NOTICE"):
        source = root / name
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"Expected regular release file: {name}")
        entry = ZipInfo(f"lolskills-scan/{name}", date_time=(2026, 9, 16, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        entry.create_system = 3
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, source.read_bytes())
digest = sha256(archive_path.read_bytes()).hexdigest()
(output / "SHA256SUMS").write_text(f"{digest}  lolskills-scan.zip\n", encoding="utf-8")
print("Built dist/lolskills-scan.zip and dist/SHA256SUMS")
