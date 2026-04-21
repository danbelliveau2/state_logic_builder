/**
 * Reads APP_VERSION from src/lib/version.js and syncs it to package.json.
 * Called automatically by the pre-commit hook.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const versionFile = path.join(root, 'src', 'lib', 'version.js');
const packageFile = path.join(root, 'package.json');

// Extract APP_VERSION from version.js  e.g.  export const APP_VERSION = '1.14';
const versionJs = fs.readFileSync(versionFile, 'utf8');
const match = versionJs.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!match) {
  console.error('sync-version: could not find APP_VERSION in version.js');
  process.exit(1);
}

const appVersion = match[1]; // e.g. "1.14"
// Convert to semver: "1.14" -> "1.14.0",  "1.14.2" stays "1.14.2"
const semver = appVersion.split('.').length === 2 ? appVersion + '.0' : appVersion;

// Update package.json
const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
if (pkg.version === semver) {
  console.log(`sync-version: already at ${semver} — no change needed`);
  process.exit(0);
}

const old = pkg.version;
pkg.version = semver;
fs.writeFileSync(packageFile, JSON.stringify(pkg, null, 2) + '\n');
console.log(`sync-version: bumped package.json ${old} → ${semver}`);
