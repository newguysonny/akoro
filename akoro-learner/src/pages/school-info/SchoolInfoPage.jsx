/**
 * SchoolInfoPage — composes the section components from ./parts.jsx.
 */
import React, { useState, useEffect, useRef } from "react";
import {
  Menu,
  X,
  MessageCircle,
  CalendarDays,
  Ticket,
  ChevronDown,
  Repeat2,
  Trophy,
  BarChart3,
  BookOpen,
  WifiOff,
  ArrowRight,
} from "lucide-react";
import { SiteNav, SFSHeader, SiteFooter } from '../../components/SiteChrome.jsx';

import { B, B2, FontImport, AnnouncementBar, Header, ProductPreviewCard, FeatureAccordion, TestimonialQuote, FeatureRow, MoreFeatures, GetStartedSteps, FAQSection, ContactSection, StatsCompare, Hero, FloatingHelpButton } from './parts.jsx';

export default function SchoolInfoPage() {
  const [showBanner, setShowBanner] = useState(true);

  return (
    <div className="min-h-screen bg-white overflow-hidden">
      <FontImport />
      {showBanner && <AnnouncementBar onDismiss={() => setShowBanner(false)} />}
      <SFSHeader/>

    <div className="mt-24 ">
      <Hero onBookDemo={() => {}} onHowItWorks={() => {}} />
    </div>
      <FeatureAccordion />
      <TestimonialQuote />
      <FeatureRow
        title="Empower standout students and get them mastering concepts faster than ever."
        desc="Support every learner from day one. Use Akoro for skill assessment and progress tracking, create custom learning paths, and so much more."
        linkText="Learn more about learning paths"
        image="https://images.unsplash.com/photo-1529390079861-591de354faf5?w=900&h=675&fit=crop"
      />
      <FeatureRow
        title="Make a real difference with personalized learning support."
        desc="Supporting every student is more important than ever. With Akoro as your AI companion, personalized tutoring comes built in at no extra cost. Adapt your existing curriculum or let our AI agents help you build the right learning plan."
        linkText="Learn more about personalized learning"
        image="https://images.unsplash.com/photo-1509062522246-3755977927d7?w=900&h=675&fit=crop"
        reverse
      />
      <MoreFeatures />
      <GetStartedSteps onGetStarted={() => {}} />
      <FAQSection />
      <ContactSection onGetStarted={() => {}} />
      <StatsCompare />
      <FloatingHelpButton />
    </div>
  );
}

