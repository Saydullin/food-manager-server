import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { RecipesPage } from './pages/RecipesPage';
import { UsersPage } from './pages/UsersPage';
import { ComplaintsPage } from './pages/ComplaintsPage';

function ProtectedRoutes() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Layout />;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoutes />}>
        <Route path="/recipes" element={<RecipesPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/complaints" element={<ComplaintsPage />} />
        <Route path="/" element={<Navigate to="/recipes" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/recipes" replace />} />
    </Routes>
  );
}

export default App;
