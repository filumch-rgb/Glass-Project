import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import { config } from '../config';
import { loggers } from '../utils/logger';

const router = Router();

interface ClaimSubmissionRequest {
  insurerName: string;
  claimNumber: string;
  policyholderName: string;
  policyholderMobile: string;
  policyholderEmail: string;
  vin: string;
}

/**
 * POST /api/submit-claim
 * 
 * Receives claim submission from web form and sends formatted email
 * to the intake email address for processing
 */
router.post('/submit-claim', async (req: Request, res: Response) => {
  try {
    const {
      insurerName,
      claimNumber,
      policyholderName,
      policyholderMobile,
      policyholderEmail,
      vin,
    }: ClaimSubmissionRequest = req.body;

    // Validate required fields
    if (!insurerName || !claimNumber || !policyholderName || !policyholderMobile || !policyholderEmail || !vin) {
      return res.status(400).json({
        error: 'All fields are required',
        missing: {
          insurerName: !insurerName,
          claimNumber: !claimNumber,
          policyholderName: !policyholderName,
          policyholderMobile: !policyholderMobile,
          policyholderEmail: !policyholderEmail,
          vin: !vin,
        },
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(policyholderEmail)) {
      return res.status(400).json({
        error: 'Invalid email format',
      });
    }

    // Validate phone format (basic)
    const phoneRegex = /^\+\d{10,15}$/;
    if (!phoneRegex.test(policyholderMobile.replace(/[\s-]/g, ''))) {
      return res.status(400).json({
        error: 'Invalid phone number format. Must include country code (e.g., +1234567890)',
      });
    }

    // Validate VIN format (17 alphanumeric characters)
    const vinRegex = /^[A-HJ-NPR-Z0-9]{17}$/i;
    if (!vinRegex.test(vin)) {
      return res.status(400).json({
        error: 'Invalid VIN format. Must be exactly 17 alphanumeric characters',
      });
    }

    // Create email body in key:value format
    const emailBody = `
Insurer Name: ${insurerName}
Claim Number: ${claimNumber}
Policyholder Name: ${policyholderName}
Policyholder Mobile: ${policyholderMobile}
Policyholder Email: ${policyholderEmail}
VIN: ${vin.toUpperCase()}

---
Submitted via web form at ${new Date().toISOString()}
    `.trim();

    // Create transporter using IMAP credentials
    const transporter = nodemailer.createTransport({
      host: config.imap.host.replace('imap', 'smtp'), // Convert imap.gmail.com to smtp.gmail.com
      port: 587,
      secure: false, // Use STARTTLS
      auth: {
        user: config.imap.user,
        pass: config.imap.password,
      },
    });

    // Send email to intake address
    const mailOptions = {
      from: config.imap.user,
      to: config.imap.user, // Send to self (intake address)
      subject: 'New Glass Claim - Web Form Submission',
      text: emailBody,
    };

    await transporter.sendMail(mailOptions);

    loggers.app.info('Claim submitted via web form', {
      claimNumber,
      insurerName,
      submittedAt: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: 'Claim submitted successfully',
      claimNumber,
    });
    return;
  } catch (error) {
    loggers.app.error('Failed to submit claim via web form', error as Error);
    res.status(500).json({
      error: 'Failed to submit claim. Please try again.',
    });
    return;
  }
});

export default router;
