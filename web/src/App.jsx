import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
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
import Security from './pages/Security.jsx'
import Verification from './pages/Verification.jsx'
import Trade from './pages/Trade.jsx'
import Wallet from './pages/Wallet.jsx'
import Welcome from './pages/Welcome.jsx'
import Withdraw from './pages/Withdraw.jsx'
import AdminDisputes from './pages/admin/AdminDisputes.jsx'
import AdminAlerts from './pages/admin/AdminAlerts.jsx'
import AdminFunds from './pages/admin/AdminFunds.jsx'
import AdminKyc from './pages/admin/AdminKyc.jsx'
import AdminLayout, { RequireAdmin } from './pages/admin/AdminLayout.jsx'
import AdminLog from './pages/admin/AdminLog.jsx'
import AdminOverview from './pages/admin/AdminOverview.jsx'
import AdminTrade from './pages/admin/AdminTrade.jsx'
import AdminUsers from './pages/admin/AdminUsers.jsx'

const priv = (el) => <RequireAuth>{el}</RequireAuth>

export default function App() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  return (
    <div className={pathname.startsWith('/admin') ? 'shell wide' : 'shell'}>
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
        <Route path="/profile/security" element={priv(<Security />)} />
        <Route path="/profile/verification" element={priv(<Verification />)} />
        <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
          <Route index element={<AdminOverview />} />
          <Route path="deposits" element={<AdminFunds kind="deposits" key="deposits" />} />
          <Route path="withdrawals" element={<AdminFunds kind="withdrawals" key="withdrawals" />} />
          <Route path="disputes" element={<AdminDisputes />} />
          <Route path="trades/:id" element={<AdminTrade />} />
          <Route path="kyc" element={<AdminKyc />} />
          <Route path="alerts" element={<AdminAlerts />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="log" element={<AdminLog />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
