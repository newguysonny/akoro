/**
 * Landing page — composes chrome + content sections.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Brain, Zap, Swords, BarChart3, Mic, School, WifiOff, Trophy,
  Link2, Menu, X, ChevronDown, ChevronLeft, ChevronRight, Star, Check, ArrowRight, Play,
  Shield, Globe, BookOpen, DollarSign, MessageSquare, Cpu, Target,
  Repeat2, Map, Users, Building2, Sparkles, GraduationCap, Clock,
  TrendingUp, Award, Lock, AlertCircle, CheckCircle2, XCircle,
  Video, CalendarDays, UserCheck, MonitorPlay, ExternalLink, Radio,
  Layers, Settings, LayoutDashboard,
} from 'lucide-react';
import AkoroLogo from '../../components/common/AkoroLogo.jsx';
import { SiteNav, SFSHeader, SiteFooter } from '../../components/SiteChrome.jsx';
import SFSHero from '../../components/SFSHero.jsx';
import NewsCarousel from '../../components/NewsCarousel.jsx';
import TrustRatings from '../../components/TrustRatings.jsx';
import QuickActions from '../../components/QuickActions.jsx';

import { API } from '../../services/api.js';
import {
  FaLinkedin, FaYoutube, FaInstagram, FaFacebook, FaXTwitter,
} from 'react-icons/fa6';
import { INSTRUCTOR_URL, B, B2, G, GL, R, BG, FontStyle, useReveal, Reveal, SL, Btn } from './shared.jsx';
import { Header, Drawer, QuickInfo, FinalCTA, Footer, StickyBar } from './chrome.jsx';
import { ProblemSolution, HowItWorks, Courses, Outcomes, Pricing, Instructors, FAQ } from './sections.jsx';

export default function LandingPage() {
  const navigate = useNavigate();
  const goSignup = () => navigate('/signup');

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#1A1A2E', overflowX: 'hidden' }}>
     <SFSHeader/>
      <FontStyle/>
      <main>
        <div className="mt-24 ">
  <SFSHero />
</div>
        
        <NewsCarousel />
        <QuickActions />
        <QuickInfo onSignup={goSignup}/>
        <TrustRatings />
        <ProblemSolution/>
        <Outcomes/>
        <Pricing/>
        <Instructors/>
        <FAQ/>
        <FinalCTA onSignup={goSignup}/>
      </main>
      <SiteFooter/>
      <StickyBar onSignup={goSignup}/>
    </div>
  );
}
