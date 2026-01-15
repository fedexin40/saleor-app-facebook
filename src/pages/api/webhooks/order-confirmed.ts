import { SaleorAsyncWebhook } from "@saleor/app-sdk/handlers/next";
import { NextApiHandler } from "next";
import { gql } from "urql";
import {
  OrderConfirmWebhookPayloadFragment
} from "../../../../generated/graphql";
import { saleorApp } from "../../../saleor-app";

const bizSdk = require('facebook-nodejs-business-sdk');
const Content = bizSdk.Content;
const CustomData = bizSdk.CustomData;
const EventRequest = bizSdk.EventRequest;
const UserData = bizSdk.UserData;
const ServerEvent = bizSdk.ServerEvent;
const FacebookAdsApi = bizSdk.FacebookAdsApi;

const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
const pixelID = process.env.FACEBOOK_PIXEL_ID;

const OrderConfirmWebhookPayload = gql`
  fragment OrderConfirmWebhookPayload on OrderConfirmed {
    order {
      fbp : metafields(keys: "_fbp")
      fbc : metafields(keys: "_fbc")
      ip : metafields(keys: "ip")
      f_external_id : metafields(keys: "f_external_id")
      userAgent : metafields(keys: "userAgent")
      eventURL : metafields(keys: "eventURL")
      userEmail
      id
      shippingAddress {
        firstName
        lastName
        countryArea
        streetAddress1
        phone
      }
      total {
        gross {
          amount
        }
        currency
      }
      lines {
        quantity
        totalPrice {
          gross {
            amount
          }
        }
        variant {
          pricing {
            price {
              gross {
                amount
              }
            }
          }
          id
          product {
            id
            slug
            name
          }
        }
      }
    }
  }
`;

const OrderConfirmGraphqlSubscription = gql`
  ${OrderConfirmWebhookPayload}

  subscription OrderConfirmed {
    event {
      ...OrderConfirmWebhookPayload
    }
  }
`;

export const orderConfirmedWebhook = new SaleorAsyncWebhook<OrderConfirmWebhookPayloadFragment>({
  name: "Order Confirmed",
  webhookPath: "api/webhooks/order-confirmed",
  event: "ORDER_CONFIRMED",
  apl: saleorApp.apl,
  query: OrderConfirmGraphqlSubscription,
});

const orderConfirmedHandler: NextApiHandler = async (req, res) => {
  let domain = new URL(process.env.NEXT_PUBLIC_SALEOR_HOST_URL || "");
  req.headers["saleor-domain"] = `${domain.host}`;
  req.headers["x-saleor-domain"] = `${domain.host}`;

  const saleorApiUrl = process.env.NEXT_PUBLIC_SALEOR_HOST_URL + "/graphql/";
  req.headers["saleor-api-url"] = saleorApiUrl;

  return orderConfirmedWebhook.createHandler(async (req, res, ctx) => {
    console.log("webhook received");

    const { payload, authData, event } = ctx;

    console.log(`Order confirmed`, event);

    const order = payload.order;

    if (!order){
      return res.status(500).json({ message: "Missing order" });
    }

    // From https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api?locale=es_ES
    const current_timestamp = Math.floor(Date.now() / 1000);
    const event_id = `${order.id}_Purchase_${current_timestamp}`;
    const ip = order.ip.ip
    const userAgent = order.userAgent.userAgent
    const fbp = order.fbp._fbp
    const fbc = order.fbc._fbc
    const external_id = order.f_external_id.f_external_id
    const eventURL = order.eventURL.eventURL
    FacebookAdsApi.init(accessToken);
    const userData = new UserData()
      // It is recommended to send Client IP and User Agent for Conversions API Events.
      .setClientIpAddress(ip)
      .setClientUserAgent(userAgent)
      .setFbp(fbp)
      .setFbc(fbc)
      .setExternalId(external_id);

    if (order.userEmail && order.userEmail.length > 0) {
      userData.setEmails([order.userEmail.trim().toLowerCase()]);
    }

    if (order.shippingAddress?.phone && order.shippingAddress?.phone.length > 0) {
      userData.setPhones([order.shippingAddress?.phone]);
    }

    const content = order.lines.map((line) =>
      new Content()
        .setId(line.variant?.product.slug)
        .setQuantity(line.quantity)
        .setItemPrice(line.variant?.pricing?.price?.gross.amount || 0.0),
    );

    const customData = new CustomData()
      .setContents(content)
      .setCurrency('MXN')
      .setValue(order.total.gross.amount)
      .setContentType('product')
      .setContentIds(order.lines.map((lines) => lines.variant?.product.slug));

    const serverEvent = new ServerEvent()
      .setEventId(event_id)
      .setEventName('Purchase')
      .setEventTime(current_timestamp)
      .setUserData(userData)
      .setCustomData(customData)
      .setEventSourceUrl(eventURL)
      .setActionSource('website');

    const eventRequest = new EventRequest(accessToken, pixelID)
      .setEvents([serverEvent])

    try {
      const response = await eventRequest.execute();
      console.log(response)
      return res.status(200).json({ message: "event handled" });
    } catch (err: any) {
      console.error('CAPI Error:', err);
      return res.status(500).json({ message: err });
    }
  })(req, res);
};

export default orderConfirmedHandler;

export const config = {
  api: {
    bodyParser: false,
  },
};
