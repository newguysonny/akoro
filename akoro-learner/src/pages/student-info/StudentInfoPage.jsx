/**
 * StudentInfoPage — composes the section components from ./parts.jsx.
 */
import React, { useState, useEffect, useRef } from "react";
import {
  Menu,
  X,
  MessageCircle,
  CalendarDays,
  Flame,
  Star,
  ChevronDown,
  Repeat2,
  Trophy,
  Mic,
  BookOpen,
  WifiOff,
  ArrowRight,
  Target,
  Brain,
} from "lucide-react";
import { SiteNav, SFSHeader, SiteFooter } from '../../components/SiteChrome.jsx';

import { B, B2, FontImport, AnnouncementBar, StudentProgressCard, FeatureAccordion, TestimonialQuote, MoreFeatures, HowItWorks, FAQSection, ContactSection, StatsCompare, Hero, FloatingHelpButton } from './parts.jsx';

export default function StudentInfoPage() {
  const [showBanner, setShowBanner] = useState(true);

  return (
    <div className="min-h-screen bg-white overflow-hidden">
      <FontImport />
      {showBanner && <AnnouncementBar onDismiss={() => setShowBanner(false)} />}
      <SFSHeader />
    <div className="mt-24 ">
     <Hero onCreateAccount={() => {}} onHowItWorks={() => {}} />
    </div>
     <FeatureAccordion />
      <TestimonialQuote />
      <MoreFeatures />
      <HowItWorks />
      <FAQSection />
      <ContactSection onGetStarted={() => {}} />
      <StatsCompare />
      <FloatingHelpButton />
    </div>
  );
}

