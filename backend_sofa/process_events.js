const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const dbFile = 'C:\\Users\\LENOVO\\Documents\\proyects 2026\\shotmap\\update\\new_data\\partido_16938859_FC Bayern M\u00fcchen_vs_Arsenal.json';

async function main() {
  const data = JSON.parse(require('fs').readFileSync(
    'C:\\Users\\LENOVO\\Documents\\proyects 2026\\shotmap\\update\\new_data\\partido_16938859_FC Bayern M\u00fcchen_vs_Arsenal.json', 'utf8'
  ));
  console.log('Claves principales:', Object.keys(data));
  console.log('Goles:', data.goles?.length);
  console.log('Tarjetas:', data.tarjetas?.length);
  console.log('Cambios:', data.cambios?.length);
  console.log('Remates:', data.remates?.length);
  console.log('Cambios (sustituciones):', data.cambios?.length);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) });