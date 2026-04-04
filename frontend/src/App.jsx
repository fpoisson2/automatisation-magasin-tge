import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { StudentPage } from "./pages/StudentPage";
import { LoginPage } from "./pages/LoginPage";
import { AdminOrders } from "./pages/AdminOrders";
import { AdminStats } from "./pages/AdminStats";
import { AdminItems } from "./pages/AdminItems";
import { AdminUsers } from "./pages/AdminUsers";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<StudentPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin" element={<AdminOrders />} />
          <Route path="/admin/stats" element={<AdminStats />} />
          <Route path="/admin/items" element={<AdminItems />} />
          <Route path="/admin/users" element={<AdminUsers />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
