---
title: Home
description: A modern, fast and accessible website rebuilt with Astro, Tailwind CSS and daisyUI.
template: marketing
sections:
  - type: hero
    eyebrow: Custom web design
    heading: Websites that earn their keep
    subheading: We rebuild dated, heavy websites into fast, accessible platforms that
      are easier to manage and rank better.
    variant: centered
    align: center
    actions:
      - label: Start a project
        href: /contact
        style: primary
        icon: arrow-right
      - label: See our services
        href: /services
        style: outline

  - type: logos
    heading: Trusted by teams of every size
    items:
      - name: Northwind
      - name: Acme Co
      - name: Lumen
      - name: Harbour Group
      - name: Verde

  - type: features
    eyebrow: Why it works
    heading: Everything a modern site needs
    subheading: Built on a design system rather than a page builder, so every
      component is consistent, fast and accessible.
    columns: 3
    items:
      - icon: zap
        title: Instant page loads
        body: Static HTML with no client-side framework payload, so pages render
          immediately and stay fast on mobile connections.
      - icon: shield
        title: Accessible by default
        body: Semantic markup, keyboard-friendly navigation, visible focus states
          and colour contrast checked against WCAG AA.
      - icon: chart
        title: Search engine ready
        body: Canonical URLs, structured data, an XML sitemap and an RSS feed are
          generated on every build.
      - icon: monitor
        title: Responsive throughout
        body: Every section adapts from small phones to ultra-wide displays
          without a single fixed-width breakpoint.
      - icon: lightbulb
        title: Your brand, not a template
        body: Colours, radii and typography are tokens, so a rebrand is a handful
          of values in one file.
      - icon: wrench
        title: Easy to maintain
        body: Content lives in Markdown and JSON, so editors can work without
          touching a component.

  - type: stats
    heading: Results we aim for
    items:
      - value: "0.9s"
        label: Largest contentful paint
        description: Typical target on a 4G connection
      - value: "100"
        label: Lighthouse accessibility
        description: Checked on every build
      - value: "60%"
        label: Less page weight
        description: Versus the average legacy build
      - value: "35"
        label: Components available
        description: All themed from design tokens

  - type: imageText
    eyebrow: Our approach
    heading: Design system first, pages second
    body: Rather than restyling twenty pages by hand, we model the site as a small
      set of reusable sections and a set of design tokens. New pages then take
      minutes, and nothing drifts out of step.
    image:
      src: assets/images/hero.jpg
      alt: Abstract gradient representing the new design system
    bullets:
      - Every colour, radius and font size comes from a token
      - Components are typed, so content errors surface at build time
      - Images are resized and converted to modern formats automatically
    actions:
      - label: How we work
        href: /services
        style: primary
        icon: arrow-right

  - type: gallery
    eyebrow: Recent work
    heading: A few recent rebuilds
    subheading: Each of these started as a slow, hard-to-edit legacy site.
    columns: 3
    images:
      - src: assets/images/work1.jpg
        alt: Corporate website rebuild
      - src: assets/images/work2.jpg
        alt: Ecommerce product page redesign
      - src: assets/images/work3.jpg
        alt: Membership portal rebuild

  - type: testimonials
    eyebrow: Client feedback
    heading: What clients say
    columns: 3
    items:
      - quote: They rebuilt a fourteen-year-old site in six weeks and our enquiry
          rate nearly doubled in the first quarter afterwards.
        name: Sarah Whitfield
        role: Marketing Director
        company: Harbour Group
        rating: 5
        avatar:
          src: assets/images/portrait.jpg
          alt: Sarah Whitfield
      - quote: The handover was the best part. Our team edits content in Markdown
          now and nobody has had to call a developer.
        name: Daniel Okafor
        role: Operations Lead
        company: Verde
        rating: 5
      - quote: Page loads went from about four seconds to under one. It made the
          biggest difference to our paid campaigns.
        name: Priya Raman
        role: Founder
        company: Lumen
        rating: 5

  - type: steps
    eyebrow: Process
    heading: How a modernization runs
    items:
      - title: Audit & crawl
        body: We crawl the existing site, inventory every page and asset, and map
          the URL structure so nothing is lost in the move.
      - title: Design system
        body: Your brand colours, type and spacing become design tokens, then
          reusable sections are built from them.
      - title: Rebuild
        body: Content is migrated into structured Markdown, images are optimised,
          and every page is composed from the section library.
      - title: Launch & verify
        body: Redirects, structured data, sitemap, accessibility and performance
          checks all run before the domain switch.

  - type: pricing
    eyebrow: Packages
    heading: Straightforward pricing
    subheading: Fixed-scope packages, no retainer required.
    note: All packages include hosting setup, analytics and a 30-day support window.
    tiers:
      - name: Refresh
        price: "£3,500"
        period: project
        description: For a small brochure site that needs bringing up to date.
        features:
          - Up to 10 pages migrated
          - Design system with your brand colours
          - Contact form and Google Analytics
        actions:
          - label: Enquire
            href: /contact
            style: outline
      - name: Rebuild
        price: "£7,500"
        period: project
        description: Our most popular package for established businesses.
        featured: true
        features:
          - Up to 40 pages migrated
          - Custom section library
          - Blog or news area with RSS
          - Redirect map for every old URL
          - Performance and accessibility report
        actions:
          - label: Start a project
            href: /contact
            style: primary
      - name: Platform
        price: "£14,000"
        period: project
        description: For sites with commerce, portals or editorial workflows.
        features:
          - Unlimited pages migrated
          - Content modelling workshop
          - Search, filtering and structured data
          - Team training and documentation
        actions:
          - label: Request a quote
            href: /contact
            style: outline

  - type: faq
    eyebrow: Questions
    heading: Frequently asked questions
    items:
      - question: Will we keep our search rankings?
        answer: Yes. We map every existing URL and generate redirects for the ones
          that change, keep your page titles and metadata, and re-publish the same
          structured data. The sitemap is regenerated automatically on each build.
      - question: How long does a rebuild take?
        answer: A ten-page brochure site typically takes three to four weeks. Larger
          sites with a blog or product catalogue run six to ten weeks, most of
          which is content migration and review.
      - question: Can our team edit the site afterwards?
        answer: Yes. Content lives in Markdown and JSON files, validated by a
          schema. Non-technical editors can work in Git-based CMS tools, and a
          developer can add a new page type in about an hour.
      - question: What happens to our existing site?
        answer: It stays live until the new build passes review. We deploy the new
          site to a staging URL first, run the checks against it, then switch the
          domain over. The old source stays available for reference.

  - type: cta
    heading: Ready to modernize?
    body: Tell us about the site you want to replace and we will come back with a
      scope, a timeline and a fixed price.
    style: primary
    actions:
      - label: Start a project
        href: /contact
        style: secondary
        icon: arrow-right
      - label: Email us
        href: mailto:hello@example.com
        style: ghost

  - type: contact
    eyebrow: Contact
    heading: Talk to us about your rebuild
    body: Send us the URL of the site you want to modernize. We reply within one
      working day.
    # Placeholder endpoint: point this at your form handler (Formspree, Netlify
    # Forms, a Worker, or an Astro action once an adapter is configured).
    form:
      action: https://formspree.io/f/your-form-id
      method: post
      submitLabel: Send message
      fields:
        - name: name
          label: Your name
          type: text
          required: true
          half: true
          placeholder: Jane Smith
        - name: email
          label: Email address
          type: email
          required: true
          half: true
          placeholder: jane@company.com
        - name: website
          label: Current website
          type: url
          placeholder: https://example.com
        - name: message
          label: What would you like to change?
          type: textarea
          required: true
          placeholder: Tell us about the site, its size and what is not working.
---

This is the Markdown body of the home page. Anything the section blocks do not
cover can be written here, and it renders with the same typography system used
across the site:

- Lists, **bold**, *italic* and [links](/services) are all styled consistently.
- Content is validated at build time, so a typo in a field name fails the build
  rather than shipping a broken page.

> Scraped pages are composed from the same blocks, so a migrated site looks like
> it was designed for the client — because it was.
