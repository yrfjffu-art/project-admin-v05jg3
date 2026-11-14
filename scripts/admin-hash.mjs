#!/usr/bin/env node
// Prints a bcrypt hash for ADMIN_PASSWORD_HASH. Reads the password from stdin so it never
// lands in shell history:   npm run admin:hash   (then type the password, press Enter)
import bcrypt from 'bcryptjs';
import readline from 'node:readline';

function strongPasswordError(pw) {
  if (pw.length < 14) return 'Use at least 14 characters';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) return 'Use at least three of: lowercase, uppercase, digits, symbols';
  return null;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
process.stderr.write('Admin password: ');
rl._writeToOutput = () => {};
rl.on('line', (pw) => {
  rl.close();
  process.stderr.write('\n');
  const err = strongPasswordError(pw);
  if (err) { console.error(`✖ ${err}`); process.exit(1); }
  console.log(bcrypt.hashSync(pw, 12));
});
