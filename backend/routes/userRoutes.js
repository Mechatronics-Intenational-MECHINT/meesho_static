const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Log = require('../models/Log');

async function userRoutes(fastify, options) {
  // Login Route
  fastify.post('/login', async (request, reply) => {
    const { username, password } = request.body;

    try {
      const user = await User.findOne({ username });
      if (!user) {
        fastify.log.warn("❌ User not found");
        return reply.code(400).send({ message: 'Invalid username or password' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return reply.code(400).send({ message: 'Invalid username or password' });
      }

      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

      await Log.create({ username, timestamp: new Date(), message: 'login' });

      reply.send({ token, username: user.username, role: user.role });
    } catch (err) {
      fastify.log.error(err);
      reply.code(500).send({ message: 'Server error' });
    }
  });

  // Logout (frontend deletes token)
  fastify.post('/logout', async (request, reply) => {
    reply.send({ message: 'Logged out successfully' });
  });
}

module.exports = userRoutes;
