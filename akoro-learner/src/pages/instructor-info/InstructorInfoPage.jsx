/**
 * InstructorInfoPage — composes the section components from ./parts.jsx.
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
  PenTool,
  CheckCircle2,
} from "lucide-react";
import { SiteNav, SFSHeader, SiteFooter } from '../../components/SiteChrome.jsx';

import { B, B2, FontImport, AnnouncementBar, ProductPreviewCard, FeatureAccordion, TestimonialQuote, FeatureRow, MoreFeatures, GetStartedSteps, FAQSection, ContactSection, StatsCompare, Hero, FloatingHelpButton } from './parts.jsx';

export default function InstructorInfoPage() {
  const [showBanner, setShowBanner] = useState(true);

  return (
    <div className="min-h-screen bg-white overflow-hidden">
      <FontImport />
      {showBanner && <AnnouncementBar onDismiss={() => setShowBanner(false)} />}
      <SFSHeader />
      <div className="mt-24 ">
      <Hero onBookDemo={() => {}} onHowItWorks={() => {}} />
      </div>
      <FeatureAccordion />
      <TestimonialQuote />
      <FeatureRow
        title="Plan smarter, not longer."
        desc="Drop in a topic and your objectives — Akoro drafts a full lesson plan, complete with worksheets and discussion prompts, ready for you to edit."
        linkText="Learn more about lesson planning"
        image="https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=900&h=675&fit=crop"
      />
      <FeatureRow
        title="See every student's progress before it's too late."
        desc="Every quiz, assignment, and lesson is tracked automatically. Akoro flags struggling students early, so you can step in before a bad week becomes a bad term."
        linkText="Learn more about class insights"
        image="https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=900&h=675&fit=crop"
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

