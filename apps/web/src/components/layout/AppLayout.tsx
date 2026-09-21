import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function AppLayout() {
  const location = useLocation();
  const isNetwork = location.pathname.startsWith('/network');

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <Topbar />
        <div
          className={`page-content ${isNetwork ? 'page-content-flush' : ''}`}
          style={isNetwork ? { padding: 0, overflow: 'hidden' } : undefined}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
}
