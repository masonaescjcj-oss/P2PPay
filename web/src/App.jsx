import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth, useAuth } from './lib/auth.jsx'
import Auth from './pages/Auth.jsx'
import Chat from './pages/Chat.jsx'
import CreateOffer from './pages/CreateOffer.jsx'
import Deposit from './pages/Deposit.jsx'
import Home from './pages/Home.jsx'
import Market from './pages/Market.jsx'
import Offer from './pages/Offer.jsx'
import Orders from './pages/Orders.jsx'
import PaymentAccounts from './pages/PaymentAccounts.jsx'
import Profile from './pages/Profile.jsx'
import Trade from './pages/Trade.jsx'
import Wallet from './pages/Wallet.jsx'
import Welcome from './pages/Welcome.jsx'
import Withdraw from './pages/Withdraw.jsx'

const priv = (el) => <RequireAuth>{el}</RequireAuth>

export default function App() {
  const { user } = useAuth()
  return (
    <div className="shell">
      <Routes>
        <Route path="/" element={user === null ? <Navigate to="/welcome" replace /> : priv(<Home />)} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/login" element={<Auth mode="login" />} />
        <Route path="/register" element={<Auth mode="register" />} />
        <Route path="/market" element={<Market />} />
        <Route path="/offers/new" element={priv(<CreateOffer />)} />
        <Route path="/offers/:id" element={<Offer />} />
        <Route path="/trades/:id" element={priv(<Trade />)} />
        <Route path="/trades/:id/chat" element={priv(<Chat />)} />
        <Route path="/orders" element={priv(<Orders />)} />
        <Route path="/wallet" element={priv(<Wallet />)} />
        <Route path="/deposit" element={priv(<Deposit />)} />
        <Route path="/withdraw" element={priv(<Withdraw />)} />
        <Route path="/profile" element={priv(<Profile />)} />
        <Route path="/profile/accounts" element={priv(<PaymentAccounts />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
