import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Chart from './pages/Chart';
import Trades from './pages/Trades';
import TradeDetail from './pages/TradeDetail';
import Strategy from './pages/Strategy';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="chart" element={<Chart />} />
        <Route path="trades" element={<Trades />} />
        <Route path="trades/:id" element={<TradeDetail />} />
        <Route path="strategy" element={<Strategy />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
