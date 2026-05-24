module.exports = function(requiredRoles) {
  return (req, res, next) => {
    const user = req.user; // populated by authMiddleware
    if (!user || !requiredRoles.includes(user.role)) {
      return res.status(403).json({ message: 'Forbidden: insufficient role' });
    }
    next();
  };
};
