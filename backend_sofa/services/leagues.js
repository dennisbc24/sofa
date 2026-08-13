const pool = require("../db");

class LeaguesService {
  async getAllLeagues() {
    const query = "SELECT DISTINCT liga as name FROM partidos ORDER BY liga;";
    const { rows } = await pool.query(query);
    return rows;
  }
}

module.exports = { LeaguesService };
