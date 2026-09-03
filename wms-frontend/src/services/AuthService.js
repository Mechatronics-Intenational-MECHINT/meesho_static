import axios from "axios";

const API_URL = "http://localhost:5001/api/users/";

const login = async (username, password) => {
    const response = await axios.post(API_URL + "login", { username, password });
    if (response.data.token) {
        localStorage.setItem("token", response.data.token);
        localStorage.setItem("username", response.data.username);
    }
    return response.data;
};

const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
};

const AuthService = { login, logout };
export default AuthService;
