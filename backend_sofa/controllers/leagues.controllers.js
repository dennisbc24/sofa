const { LeaguesService } = require("../services/leagues");

const leaguesService = new LeaguesService();

const getAllLeagues = async (req, res, next) => {
  try {
    const leagues = await leaguesService.getAllLeagues();
    res.json(leagues);
  } catch (error) {
    next(error);
  }
};

module.exports = { getAllLeagues };
