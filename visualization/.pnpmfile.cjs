module.exports = {
  hooks: {
    readPackage(pkg) {
      // Auto-approve build scripts for these packages
      if (['bcrypt', 'sqlite3', '@scarf/scarf', 'unrs-resolver'].includes(pkg.name)) {
        pkg.hasInstallScript = true;
      }
      return pkg;
    }
  }
}