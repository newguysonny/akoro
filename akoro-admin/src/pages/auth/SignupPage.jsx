import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Admin accounts are pre-created — no self-registration.
export default function SignupPage() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/signin', { replace: true }); }, [navigate]);
  return null;
}
