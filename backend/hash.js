const bcrypt = require("bcryptjs");

const hashedPasswordadmin = "$2y$10$0EXCWoDOUF24qfZ93TDhduCyT10ly40MJfV2D.eeEoSsc13TjUqgC"; // Your stored hash
const inputPasswordadmin = "admin123"; // The password you're entering
const hashedPasswordoperator = "$2y$10$a1TGH4VdB6lJjR6wy.Mi1eRo3DbRKRtiPpA9BY9nBcHphYF6BiF3m"; // Your stored hash
const inputPasswordoperator = "operator123"; // The password you're entering

bcrypt.compare(inputPasswordadmin, hashedPasswordadmin).then(isMatch => {
    console.log(isMatch ? "✅ Password Match!" : "❌ Password does NOT match!");
});
bcrypt.compare(inputPasswordoperator, hashedPasswordoperator).then(isMatch => {
    console.log(isMatch ? "✅ Password Match!" : "❌ Password does NOT match!");
});


