// src/services/external/payment/stripeService.js
import Stripe from 'stripe';

class StripeService {
  constructor() {
    // Lazy-init: the Stripe client is created on first use so that
    // process.env.STRIPE_SECRET_KEY is already loaded by dotenv.
    this._stripe = null;
  }

  get stripe() {
    if (!this._stripe) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) {
        throw new Error(
          'STRIPE_SECRET_KEY is not set. Make sure dotenv loaded .env.development before importing stripeService.'
        );
      }
      this._stripe = new Stripe(key, { apiVersion: '2023-10-16' });
    }
    return this._stripe;
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

  /**
   * Confirmar/verificar el estado de un PaymentIntent
   * Si el pago ya fue completado por el cliente, retorna success
   * Si el pago está pendiente, intenta confirmarlo (para casos de pago manual)
   */
  async confirmPayment(paymentIntentId) {
    try {
      if (!paymentIntentId) {
        console.log('StripeService - confirmPayment: No payment intent ID provided, skipping');
        return { status: 'skipped', message: 'No payment intent ID' };
      }

      // Primero obtener el estado actual del PaymentIntent
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      
      // Si ya está completado, retornar éxito
      if (paymentIntent.status === 'succeeded') {
        return { status: 'succeeded', paymentIntent };
      }

      // Si está pendiente de confirmación y tiene método de pago, intentar confirmar
      if (paymentIntent.status === 'requires_confirmation' && paymentIntent.payment_method) {
        const confirmed = await this.stripe.paymentIntents.confirm(paymentIntentId);
        return { status: confirmed.status, paymentIntent: confirmed };
      }

      // Si requiere acción del cliente (3D Secure, etc.) o no tiene método de pago
      if (paymentIntent.status === 'requires_action' || paymentIntent.status === 'requires_payment_method') {
        console.log(`StripeService - confirmPayment: Payment requires client action (${paymentIntent.status})`);
        return { status: paymentIntent.status, paymentIntent, requiresAction: true };
      }

      // Para cualquier otro estado, retornar el estado actual
      return { status: paymentIntent.status, paymentIntent };
    } catch (error) {
      console.error('StripeService - confirmPayment error:', error);
      throw error;
    }
  }

  /**
   * Capturar un PaymentIntent (para pagos con capture_method: 'manual')
   */
  async capturePayment(paymentIntentId, amountToCapture = null) {
    try {
      const captureParams = {};
      if (amountToCapture) {
        captureParams.amount_to_capture = amountToCapture;
      }
      
      const paymentIntent = await this.stripe.paymentIntents.capture(paymentIntentId, captureParams);
      return paymentIntent;
    } catch (error) {
      console.error('StripeService - capturePayment error:', error);
      throw error;
    }
  }
}

export default new StripeService();