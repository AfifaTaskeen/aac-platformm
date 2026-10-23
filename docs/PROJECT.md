# BuddyTalk — Adaptive AAC Platform

## Project Overview

BuddyTalk is a web-based Augmentative and Alternative Communication (AAC) application for children who have communication difficulties, including children with Cerebral Palsy. It gives a child a picture-based way to build and speak sentences, instead of relying on speech alone.

## Problem Statement

Most commercial AAC software is expensive and built for institutions rather than individual families. A family that could genuinely benefit from AAC often cannot afford it, or is given far more complexity than their child actually needs. BuddyTalk exists to close that gap with a free, simple system a caregiver can set up on their own, without any special training.

## Target Users

- Children with communication difficulties, including children with Cerebral Palsy, who can make a deliberate selection (a tap) even when speech is difficult.
- Parents and caregivers, who create the account, set up the child's profile, and personalize the board.
- Anyone supervising the child's use of the device, who benefits from Settings being protected separately from the board itself.

## How It Works

A caregiver registers an account, creates a child profile, and the app automatically fills in a complete starting board — 13 categories and around 300 picture cards — so there's nothing to build from scratch. The child taps a card, it's added to a sentence bar, and the word is spoken aloud. Several cards can be combined into a short sentence before clearing it and starting again.

## Core Features (as actually implemented)

- Caregiver registration and login, with password-based sign-in and an optional "Sign in with Google" option.
- Password reset via email.
- One child profile per account, with a fully pre-filled board created automatically on setup.
- The communication board itself: category folders, picture cards, sentence building, and text-to-speech.
- Custom cards — a caregiver can add their own photo (from the gallery or camera) and their own voice recording for any card, which plays instead of the synthetic voice.
- Card and folder reordering ("Card Flexibility") — drag to rearrange, tap still speaks the card normally.
- A separate 4-character Settings PIN that protects the Settings screen from the account's own login password, with a CAPTCHA-based recovery flow if it's forgotten.
- Per-child accessibility settings: grid size, text size, light/dark theme, card alignment, animation, and voice preference.
- Caregiver-uploaded photos and recordings are stored in AWS S3; the default picture library is also served from AWS S3.
- Every family's data — child profile, cards, folders, uploads — is fully isolated from every other account.

## Project Status

The core application is fully built and has been tested end-to-end, including authentication, the communication board, file uploads, and account-isolation/security checks. It is in the process of being deployed for real use, and a conversion to a mobile app (via Capacitor) is planned as the next phase.

## What's Intentionally Not Included Yet

- Support for more than one child profile per account.
- A separate therapist-facing role.
- Any AI/ML-based personalization — card usage is not currently tracked, and no recommendation logic exists. (A simple, frequency-based "frequently used cards" feature has been designed but not yet built.)
- A native mobile app — the web application is the current deliverable; a Capacitor-based Android build is the planned next step.
