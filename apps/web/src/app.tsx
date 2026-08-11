import { Routes, Route, Navigate } from 'react-router-dom';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<div className="text-white">单词之旅</div>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}