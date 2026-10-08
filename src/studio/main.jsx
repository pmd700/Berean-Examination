import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/rajdhani/400.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@/index.css';
import CourseStudio from './CourseStudio';
import { installAppTypography } from '@/styles/typography';

installAppTypography();

ReactDOM.createRoot(document.getElementById('root')).render(<CourseStudio />);
