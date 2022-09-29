import ta.trend as trend
import pandas as pd
from binance.client import Client
from binance.enums import *

client = Client()


def getATR(symbol, interval, lookback):
    frame = pd.DataFrame(client.get_historical_klines(symbol, interval, lookback + 'day ago UTC'))
    frame = frame.iloc[:, :6]
    frame.columns = ['Time', 'Open', 'High', 'Low', 'Close', 'Volume']
    frame = frame.set_index('Time')
    frame.index = pd.to_datetime(frame.index, unit='ms')
    frame = frame.astype(float)
    tr = pd.Series([max(frame.iloc[i][1] - frame.iloc[i][2], frame.iloc[i][1] - frame.iloc[i - 1][3],
                        frame.iloc[i - 1][3] - frame.iloc[i][2]) for i in range(1, len(frame.index))])
    return trend.ema_indicator(tr, 14).iloc[-1]


print(getATR('MATICUSDT', Client.KLINE_INTERVAL_12HOUR, '10'))
