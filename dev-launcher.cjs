// Launcher script to start vite from the correct directory
process.chdir(__dirname);
require('child_process').execSync(
  '"C:\\Program Files\\nodejs\\npx.cmd" vite --port 5173',
  { stdio: 'inherit', cwd: __dirname }
);
