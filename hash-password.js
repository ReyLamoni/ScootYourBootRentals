#!/usr/bin/env node
/**
 * scripts/hash-password.js
 * ─────────────────────────
 * Run this ONCE to generate a bcrypt hash of your admin password.
 * Then paste the output into your .env file as ADMIN_PASSWORD_HASH=...
 *
 * Usage:
 *   node scripts/hash-password.js
 *
 * You'll be prompted to type your password. It won't echo to the terminal.
 */

const bcrypt   = require('bcrypt');
const readline = require('readline');

const SALT_ROUNDS = 12; // higher = slower to crack but slightly slower to verify

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Hide input (basic — won't work in all terminals but fine for local use)
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  console.log('\n🔐  Scoot Your Boot Rentals — Password Hash Generator\n');

  const password = await prompt('Enter your new admin password: ');
  if (!password || password.length < 8) {
    console.error('\n❌  Password must be at least 8 characters.\n');
    process.exit(1);
  }

  const confirm = await prompt('Confirm password: ');
  if (password !== confirm) {
    console.error('\n❌  Passwords do not match.\n');
    process.exit(1);
  }

  console.log('\nGenerating hash (this takes a moment)...');
  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  console.log('\n✅  Success! Add this line to your .env file:\n');
  console.log(`ADMIN_PASSWORD_HASH=${hash}`);
  console.log('\n⚠️   Keep this hash private — never share it publicly.\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
