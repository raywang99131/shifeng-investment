import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { MainLayout } from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { MarketPanel, ResearchPanel, PortfolioPanel, AlternativePanel, NewsPanel, StockDetailPanel } from './pages';

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<MainLayout />}>
              <Route index element={<Navigate to="/news" replace />} />
              <Route path="news" element={<NewsPanel />} />
              <Route path="market" element={<MarketPanel />} />
              <Route path="research" element={<ResearchPanel />} />
              <Route path="portfolio" element={<PortfolioPanel />} />
              <Route path="alternative" element={<AlternativePanel />} />
              <Route path="stock/:code" element={<StockDetailPanel />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  );
};

export default App;