// src/services/external/payment/stripeService.js
import Stripe from 'stripe';

class StripeService {
  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16'
    });
  }

  async createPaymentIntent(amount, currency = 'usd', metadata = {}) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount,
        currency,
        metadata,
        automatic_payment_methods: {
          enabled: true
        }
      });
      return paymentIntent;
    } catch (error) {
      console.error('StripeService - createPaymentIntent error:', error);
      throw error;
    }
  }

  async createCustomer(data) {
    try {
      const customer = await this.stripe.customers.create(data);
      return customer;
    } catch (error) {
      console.error('StripeService - createCustomer error:', error);
      throw error;
    }
  }

  async createSubscription(customerId, priceId) {
    try {
      const subscription = await this.stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent']
      });
      return subscription;
    } catch (error) {
      console.error('StripeService - createSubscription error:', error);
      throw error;
    }
  }

  async handleWebhook(rawBody, signature) {
    try {
      const event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      return event;
    } catch (error) {
      console.error('StripeService - handleWebhook error:', error);
      throw error;
    }
  }

  async getPaymentIntent(id) {
    try {
      const pi = await this.stripe.paymentIntents.retrieve(id);
      return pi;
    } catch (error) {
      console.error('StripeService - getPaymentIntent error:', error);
      throw error;
    }
  }
}

export default new StripeService();