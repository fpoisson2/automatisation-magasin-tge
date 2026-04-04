import { createContext, useContext, useState, useEffect } from "react";
import { getMe } from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [studentDA, setStudentDA] = useState(localStorage.getItem("studentDA") || "");
  const [studentName, setStudentName] = useState(localStorage.getItem("studentName") || "");
  const [admin, setAdmin] = useState(null); // { id, role, name } or null
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMe().then((data) => {
      if (data) setAdmin(data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const loginStudent = (da, name) => {
    setStudentDA(da);
    setStudentName(name);
    localStorage.setItem("studentDA", da);
    localStorage.setItem("studentName", name);
  };

  const logoutStudent = () => {
    setStudentDA("");
    setStudentName("");
    localStorage.removeItem("studentDA");
    localStorage.removeItem("studentName");
    localStorage.removeItem("cart");
    localStorage.removeItem("dismissedOrders");
  };

  return (
    <AuthContext.Provider value={{ studentDA, studentName, loginStudent, logoutStudent, admin, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
