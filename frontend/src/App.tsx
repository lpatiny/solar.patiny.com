import HomePage from './pages/home/HomePage.tsx';
import { AuthProvider } from './pages/home/components/AuthContext.tsx';

export default function App() {
  return (
    <AuthProvider>
      <HomePage />
    </AuthProvider>
  );
}
