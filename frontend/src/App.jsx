import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { AdminNotifProvider } from "./hooks/useAdminNotifications";
import { StudentPage } from "./pages/StudentPage";
import { LoginPage } from "./pages/LoginPage";
import { AdminOrders } from "./pages/AdminOrders";
import { AdminStats } from "./pages/AdminStats";
import { AdminItems } from "./pages/AdminItems";
import { AdminUsers } from "./pages/AdminUsers";

function AdminLayout({ children }) {
  return <AdminNotifProvider>{children}</AdminNotifProvider>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<StudentPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin" element={<AdminLayout><AdminOrders /></AdminLayout>} />
          <Route path="/admin/stats" element={<AdminLayout><AdminStats /></AdminLayout>} />
          <Route path="/admin/items" element={<AdminLayout><AdminItems /></AdminLayout>} />
          <Route path="/admin/users" element={<AdminLayout><AdminUsers /></AdminLayout>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
